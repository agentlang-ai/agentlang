import type { ValidationAcceptor, ValidationChecks } from 'langium';
import { Model, AgentlangAstType, Def } from './generated/ast.js';
import type { AgentlangServices } from './agentlang-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: AgentlangServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.AgentlangValidator;
    const checks: ValidationChecks<AgentlangAstType> = {
        Model: validator.checkUniqueDefs,
        Def:   validator.checkUniqueParams
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class AgentlangValidator {

     // our new validation function for defs
     checkUniqueDefs(model: Model, accept: ValidationAcceptor): void {
        // create a set of visited functions
        // and report an error when we see one we've already seen
        const reported = new Set();
        model.defs.forEach(d => {
            if (reported.has(d.name)) {
                accept('error',  `Def has non-unique name '${d.name}'.`,  {node: d, property: 'name'});
            }
            reported.add(d.name);
        });
    }

    checkUniqueParams(def: Def, accept: ValidationAcceptor): void {
        const reported = new Set();
        def.params.forEach(p => {
            if (reported.has(p.name)) {
                accept('error', `Param ${p.name} is non-unique for Def '${def.name}'`, {node: p, property: 'name'});
            }
            reported.add(p.name);
        });
    }

}
