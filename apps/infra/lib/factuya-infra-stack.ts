import { Stack, type StackProps } from "aws-cdk-lib/core";
import type { Construct } from "constructs";

export class FactuyaInfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Scaffold inicial (ADR-0007): sin recursos todavía. Cada pieza de
    // docs/aws/aws-infrastructure-sdd.md se agrega aquí una vez decidida con
    // el usuario, siguiendo el orden de dependencia de docs/flows.md.
  }
}
