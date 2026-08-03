import { App } from "aws-cdk-lib/core";
import { FactuyaInfraStack } from "../lib/factuya-infra-stack";

const app = new App();

new FactuyaInfraStack(app, "FactuyaInfraStack", {
  /* Sin 'env', el stack queda agnóstico de cuenta/región — un mismo template
   * sintetizado se puede desplegar en cualquier cuenta. Se fija explícitamente
   * cuando exista una cuenta de destino real acordada (ver ADR-0007). */
});
