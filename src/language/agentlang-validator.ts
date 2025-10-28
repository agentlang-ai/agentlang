import type { ValidationAcceptor, ValidationChecks } from 'langium';
import {
  AgentlangAstType,
  AttributeDefinition,
  isStandaloneStatement,
  ModuleDefinition,
  SchemaDefinition,
} from './generated/ast.js';
import type { AgentlangServices } from './agentlang-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: AgentlangServices) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.AgentlangValidator;
  const checks: ValidationChecks<AgentlangAstType> = {
    ModuleDefinition: validator.checkUniqueDefs,
    SchemaDefinition: validator.checkUniqueAttributes,
  };
  registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class AgentlangValidator {
  // our new validation function for defs
  checkUniqueDefs(module: ModuleDefinition, accept: ValidationAcceptor): void {
    // create a set of visited functions
    // and report an error when we see one we've already seen
    const reported = new Set();
    module.defs.forEach(d => {
      let n: string | undefined;
      if (!isStandaloneStatement(d)) {
        if (
          d.$type === 'PublicWorkflowDefinition' ||
          d.$type === 'PublicAgentDefinition' ||
          d.$type === 'PublicEventDefinition'
        ) {
          n = d.def.name;
        } else {
          n = d.name;
        }
        if (
          d.$type != 'WorkflowDefinition' &&
          d.$type != 'FlowDefinition' &&
          d.$type != 'PublicWorkflowDefinition' &&
          d.$type != 'ScenarioDefinition' &&
          d.$type != 'DirectiveDefinition' &&
          d.$type != 'GlossaryEntryDefinition' &&
          reported.has(n)
        ) {
          accept('error', `Definition has non-unique name '${n}'.`, {
            node: d,
            property: 'name',
          });
        }
        if (
          d.$type != 'FlowDefinition' &&
          d.$type != 'ScenarioDefinition' &&
          d.$type != 'DirectiveDefinition' &&
          d.$type != 'GlossaryEntryDefinition'
        ) {
          reported.add(n);
        }
      }
    });
  }

  checkUniqueAttributes(def: SchemaDefinition, accept: ValidationAcceptor): void {
    // create a set of visited functions
    // and report an error when we see one we've already seen
    const reported = new Set();
    if (def.$type === 'PublicEventDefinition') {
      def = def.def;
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
