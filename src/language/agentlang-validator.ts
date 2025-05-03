import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type { AgentlangAstType, Person } from './generated/ast.js';
import type { AgentlangServices } from './agentlang-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: AgentlangServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.AgentlangValidator;
    const checks: ValidationChecks<AgentlangAstType> = {
        Person: validator.checkPersonStartsWithCapital
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class AgentlangValidator {

    checkPersonStartsWithCapital(person: Person, accept: ValidationAcceptor): void {
        if (person.name) {
            const firstChar = person.name.substring(0, 1);
            if (firstChar.toUpperCase() !== firstChar) {
                accept('warning', 'Person name should start with a capital.', { node: person, property: 'name' });
            }
        }
    }

}
