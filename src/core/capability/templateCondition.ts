import type { LocatorBundle, LocatorStrategy } from '../locator/schema.js';
import type { ConditionMatcher } from '../outcome/condition.js';
import { resolveTemplate, type TemplateValues } from './resolveTemplate.js';

// Resolves every template inside a locator bundle or a condition before replay uses it.
// A value substituted into a pattern is escaped, so a member ID is matched literally
// and cannot change what the regular expression means.

export type Templated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: 'UnresolvedReference'; readonly references: readonly string[] };

type Anchor = Extract<LocatorStrategy, { kind: 'anchor-relative' }>['anchor'];
type Text = (source: string, asPattern?: boolean) => string;

export function templateBundle(bundle: LocatorBundle, values: TemplateValues, allowedEnv: readonly string[]): Templated<LocatorBundle> {
  const resolver = createResolver(values, allowedEnv);
  return finish(bundleWith(bundle, resolver.text), resolver.unresolved);
}

export function templateCondition(condition: ConditionMatcher, values: TemplateValues, allowedEnv: readonly string[]): Templated<ConditionMatcher> {
  const resolver = createResolver(values, allowedEnv);
  return finish(conditionWith(condition, resolver.text), resolver.unresolved);
}

// Collects every unresolved reference across the whole structure, so one failure names
// all of them rather than the first.
function createResolver(values: TemplateValues, allowedEnv: readonly string[]): { readonly text: Text; readonly unresolved: string[] } {
  const unresolved: string[] = [];
  const escaped: TemplateValues = { inputs: escapeAll(values.inputs), outputs: escapeAll(values.outputs), env: escapeAll(values.env) };
  const text: Text = (source, asPattern = false) => {
    const resolution = resolveTemplate(source, asPattern ? escaped : values, allowedEnv);
    if (resolution.ok) return resolution.text;
    unresolved.push(...resolution.references);
    return source;
  };
  return { text, unresolved };
}

function finish<T>(value: T, unresolved: readonly string[]): Templated<T> {
  return unresolved.length === 0 ? { ok: true, value } : { ok: false, failure: 'UnresolvedReference', references: [...unresolved] };
}

function bundleWith(bundle: LocatorBundle, text: Text): LocatorBundle {
  return { ...bundle, strategies: bundle.strategies.map((strategy) => strategyWith(strategy, text)) };
}

function strategyWith(strategy: LocatorStrategy, text: Text): LocatorStrategy {
  switch (strategy.kind) {
    case 'role-name':
      return { ...strategy, name: text(strategy.name) };
    case 'label':
    case 'text':
      return { ...strategy, text: text(strategy.text) };
    case 'test-id':
      return { ...strategy, value: text(strategy.value) };
    case 'structural':
      return { ...strategy, path: text(strategy.path) };
    case 'anchor-relative':
      return { ...strategy, anchor: anchorWith(strategy.anchor, text) };
  }
}

function anchorWith(anchor: Anchor, text: Text): Anchor {
  switch (anchor.kind) {
    case 'role-name':
      return { ...anchor, name: text(anchor.name) };
    case 'label':
    case 'text':
      return { ...anchor, text: text(anchor.text) };
  }
}

function conditionWith(condition: ConditionMatcher, text: Text): ConditionMatcher {
  switch (condition.kind) {
    case 'elementPresent':
      return { ...condition, target: bundleWith(condition.target, text) };
    case 'textMatches':
      return { ...condition, target: bundleWith(condition.target, text), pattern: text(condition.pattern, true) };
    case 'urlMatches':
      return { ...condition, pattern: text(condition.pattern, true) };
    case 'httpStatus':
    case 'dialogPresent':
    case 'outputResolvable':
      return condition;
    case 'all':
    case 'any':
      return { ...condition, of: condition.of.map((child) => conditionWith(child, text)) };
    case 'not':
      return { ...condition, of: conditionWith(condition.of, text) };
  }
}

function escapeAll(record: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')]));
}
