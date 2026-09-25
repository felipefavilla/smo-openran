// Consumidor dos topicos VES publicados pelo VES Collector no barramento Kafka
// do SMO. E o mesmo caminho de dados que uma rApp usaria para consumir telemetria
// da interface O1.

import { Kafka, logLevel } from 'kafkajs';
import { config, VES_TOPICS } from './config.js';
import { store } from './store.js';

const topicDomain = new Map(VES_TOPICS.map((t) => [t.topic, t.domain]));

export async function startKafkaConsumer() {
  const kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    logLevel: logLevel.ERROR,
    retry: { initialRetryTime: 2000, retries: 100 },
  });

  const consumer = kafka.consumer({
    groupId: config.kafka.groupId,
    sessionTimeout: 30000,
    allowAutoTopicCreation: true,
  });

  consumer.on(consumer.events.CONNECT, () => {
    store.kafkaConnected = true;
    console.log('[kafka] conectado a', config.kafka.brokers.join(','));
  });
  consumer.on(consumer.events.DISCONNECT, () => {
    store.kafkaConnected = false;
    console.warn('[kafka] desconectado');
  });

  await consumer.connect();

  for (const { topic } of VES_TOPICS) {
    try {
      await consumer.subscribe({ topic, fromBeginning: true });
    } catch (err) {
      console.warn(`[kafka] nao foi possivel assinar ${topic}: ${err.message}`);
    }
  }

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const text = message.value?.toString();
      if (!text) return;
      try {
        store.ingest(topicDomain.get(topic) || 'other', JSON.parse(text));
      } catch {
        // Mensagem fora do formato VES: registrada como evento cru.
        store.ingest('other', { event: { commonEventHeader: { eventName: topic, sourceName: 'kafka' } }, payload: text });
      }
    },
  });

  return consumer;
}
