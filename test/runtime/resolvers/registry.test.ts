import { describe, test, assert, beforeEach } from 'vitest';
// Import interpreter first to establish correct module loading order (breaks circular dep)
import '../../../src/runtime/interpreter.js';
import {
  registerResolver,
  setResolver,
  getResolver,
  getResolverNameForPath,
  resetResolverRegistry,
} from '../../../src/runtime/resolvers/registry.js';
import { Resolver, GenericResolver } from '../../../src/runtime/resolvers/interface.js';

describe('Resolver Registry', () => {
  beforeEach(() => {
    resetResolverRegistry();
  });

  test('registerResolver stores factory and returns name', () => {
    const name = registerResolver('test-res', () => new Resolver('test-res'));
    assert.equal(name, 'test-res');
  });

  test('setResolver maps entity path to resolver name', () => {
    registerResolver('myRes', () => new Resolver('myRes'));
    setResolver('Mod/Entity', 'myRes');
    assert.equal(getResolverNameForPath('Mod/Entity'), 'myRes');
  });

  test('setResolver throws when resolver name not registered', () => {
    assert.throws(() => setResolver('Mod/Entity', 'nonexistent'), /Resolver not found/);
  });

  test('getResolver returns resolver instance for mapped path', () => {
    registerResolver('gr', () => new GenericResolver('gr'));
    setResolver('Mod/E', 'gr');
    const r = getResolver('Mod/E');
    assert(r instanceof GenericResolver);
    assert.equal(r.getName(), 'gr');
  });

  test('getResolver calls factory each time (fresh instance)', () => {
    let callCount = 0;
    registerResolver('counter', () => {
      callCount++;
      return new Resolver('counter');
    });
    setResolver('Mod/X', 'counter');

    getResolver('Mod/X');
    getResolver('Mod/X');
    assert.equal(callCount, 2);
  });

  test('getResolver throws for unmapped path', () => {
    assert.throws(() => getResolver('Unknown/Path'), /No resolver registered for/);
  });

  test('getResolverNameForPath returns undefined for unmapped path', () => {
    assert.equal(getResolverNameForPath('Unknown/Path'), undefined);
  });

  test('path remapping to a different resolver', () => {
    registerResolver('res1', () => new Resolver('res1'));
    registerResolver('res2', () => new Resolver('res2'));
    setResolver('Mod/E', 'res1');
    assert.equal(getResolverNameForPath('Mod/E'), 'res1');

    setResolver('Mod/E', 'res2');
    assert.equal(getResolverNameForPath('Mod/E'), 'res2');

    const r = getResolver('Mod/E');
    assert.equal(r.getName(), 'res2');
  });

  test('multiple paths to same resolver', () => {
    registerResolver('shared', () => new Resolver('shared'));
    setResolver('Mod/A', 'shared');
    setResolver('Mod/B', 'shared');

    assert.equal(getResolverNameForPath('Mod/A'), 'shared');
    assert.equal(getResolverNameForPath('Mod/B'), 'shared');

    const r1 = getResolver('Mod/A');
    const r2 = getResolver('Mod/B');
    assert.equal(r1.getName(), 'shared');
    assert.equal(r2.getName(), 'shared');
  });

  test('resetResolverRegistry clears all mappings', () => {
    registerResolver('temp', () => new Resolver('temp'));
    setResolver('Mod/T', 'temp');
    assert.equal(getResolverNameForPath('Mod/T'), 'temp');

    resetResolverRegistry();

    assert.equal(getResolverNameForPath('Mod/T'), undefined);
    assert.throws(() => getResolver('Mod/T'), /No resolver registered for/);
    assert.throws(() => setResolver('Mod/T', 'temp'), /Resolver not found/);
  });
});
