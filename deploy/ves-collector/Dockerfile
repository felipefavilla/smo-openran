# Variante enxuta do Dockerfile oficial do O-RAN SC OAM.
#
# O Dockerfile oficial (preservado ao lado como Dockerfile.official) executa um
# estagio intermediario que clona os repositorios 3GPP SA5 MnS (Rel-16 e Rel-18)
# para popular o repositorio de esquemas externos do VES Collector. Esses esquemas
# so sao usados para validar eventos 3GPP "stndDefined" (SEC_3GPP_*), que os
# simuladores NTS-NG desta implementacao nao emitem.
#
# Esta variante copia apenas o repositorio de esquemas local -- que ja contem os
# esquemas experimentais do O-RAN SC referenciados em schema-map.json, incluindo
# o "o-ran-sc-du-hello-world-pm-streaming-oas3" usado pela telemetria de PM.
#
# Resultado: build em segundos, sem dependencia de rede externa, sem alterar
# nenhum arquivo de configuracao funcional do componente oficial.

ARG BASEIMAGE=nexus3.onap.org:10001/onap/org.onap.dcaegen2.collectors.ves.vescollector:1.12.5
FROM ${BASEIMAGE}

COPY --chown=vescollector:vescollector externalRepo /opt/app/VESCollector/etc/externalRepo
