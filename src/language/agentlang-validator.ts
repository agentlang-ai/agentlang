import type { ValidationAcceptor, ValidationChecks } from 'langium';
import { AgentlangAstType, AttributeDefinition, SchemaDefinition } from './generated/ast.js';
import type { AgentlangServices } from './agentlang-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: AgentlangServices) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.AgentlangValidator;
  const checks: ValidationChecks<AgentlangAstType> = {
    SchemaDefinition: validator.checkUniqueAttributes,
  };
  registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class AgentlangValidator {
  checkUniqueAttributes(def: SchemaDefinition, accept: ValidationAcceptor): void {
    // create a set of visited functions
    // and report an error when we see one we've already seen
    const reported = new Set();
    if (def.$type === 'PublicEventDefinition') {
      def = def.def;
    }
    if (!def?.schema?.attributes) {
      return;
    }
    def.schema.attributes.forEach((a: AttributeDefinition) => {
      if (reported.has(a.name)) {
        accept('error', `'${def.name} " - attribute has non-unique name '${a.name}'.`, {
          node: a,
          property: 'name',
        });
      }
      reported.add(a.name);
    });
  }
}
