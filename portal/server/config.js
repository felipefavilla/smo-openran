// Configuracao do portal, toda vinda do ambiente (definida no docker-compose).

const env = process.env;

export const config = {
  port: Number(env.PORT || 8080),

  sdnc: {
    baseUrl: env.SDNC_BASE_URL || 'http://controller:8181',
    username: env.SDNC_USERNAME || 'admin',
    password: env.SDNC_PASSWORD || 'admin',
  },

  kafka: {
    brokers: (env.KAFKA_BROKERS || 'kafka:9092').split(',').map((s) => s.trim()),
    clientId: 'smo-portal',
    groupId: env.KAFKA_GROUP_ID || 'smo-portal',
  },

  a1: {
    pmsBaseUrl: env.A1_PMS_BASE_URL || 'http://a1-pms:8081',
    ricBaseUrl: env.NEAR_RT_RIC_BASE_URL || 'http://near-rt-ric:8085',
  },

  docker: {
    socket: env.DOCKER_SOCKET || '/var/run/docker.sock',
  },

  // Funcoes de rede da pilha Open RAN gerenciada, na ordem em que aparecem na UI.
  managedNf: (env.MANAGED_NF || 'o-du-1,o-ru-1,o-ru-2').split(',').map((s) => s.trim()).filter(Boolean),

  links: {
    odlux: env.ODLUX_PUBLIC_URL || 'http://localhost:8181',
    ves: env.VES_PUBLIC_URL || 'http://localhost:8383',
  },

  // Janela de retencao em memoria dos eventos VES.
  retention: {
    maxEvents: Number(env.MAX_EVENTS || 3000),
    maxAlarms: Number(env.MAX_ALARMS || 500),
    seriesMinutes: Number(env.SERIES_MINUTES || 60),
  },
};

// Topicos Kafka alimentados pelo VES Collector, conforme ves-dmaap-config.json
// do projeto OAM da O-RAN Software Community.
export const VES_TOPICS = [
  { topic: 'unauthenticated.VES_PNFREG_OUTPUT', domain: 'pnfRegistration' },
  { topic: 'unauthenticated.SEC_FAULT_OUTPUT', domain: 'fault' },
  { topic: 'unauthenticated.SEC_HEARTBEAT_OUTPUT', domain: 'heartbeat' },
  { topic: 'unauthenticated.VES_MEASUREMENT_OUTPUT', domain: 'measurement' },
  { topic: 'unauthenticated.VES_FILE_READY_OUTPUT', domain: 'fileReady' },
  { topic: 'unauthenticated.VES_O_RAN_SC_HELLO_WORLD_PM_STREAMING_OUTPUT', domain: 'pmStreaming' },
  { topic: 'unauthenticated.SEC_3GPP_FAULTSUPERVISION_OUTPUT', domain: 'fault3gpp' },
  { topic: 'unauthenticated.SEC_OTHER_OUTPUT', domain: 'other' },
];
