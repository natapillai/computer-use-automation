import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGoal } from '../discovery/prompt.js';
import { DiscoveryRequest } from './discoverCommand.js';
import { ReviewDecision } from './reviewCommand.js';

// The committed requests are files a person writes by hand, and nothing else in the suite reads
// them. A request that does not parse, or whose goal names an input nobody declared, only fails
// when somebody spends a live run on it, which is how the first write run was spent.

const DIRECTORY = 'requests';

async function requestFiles(): Promise<{ reviews: string[]; goals: string[] }> {
  const names = (await readdir(DIRECTORY)).filter((name) => name.endsWith('.json')).sort();
  return {
    reviews: names.filter((name) => name.endsWith('.review.json')),
    goals: names.filter((name) => !name.endsWith('.review.json')),
  };
}

async function read(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(DIRECTORY, name), 'utf8'));
}

describe('the committed discovery requests', () => {
  it('has at least one request to check, so an empty directory cannot pass quietly', async () => {
    const files = await requestFiles();

    expect(files.goals.length).toBeGreaterThan(0);
    expect(files.reviews.length).toBeGreaterThan(0);
  });

  it('parses every request, and builds every goal against the inputs it declares', async () => {
    const { goals } = await requestFiles();

    for (const name of goals) {
      const parsed = DiscoveryRequest.safeParse(await read(name));
      expect(parsed.success, `${name} ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
      if (!parsed.success) continue;

      // Values do not matter here. What matters is that every template the goal names is an
      // input the request declares, and that the goal carries no value of its own.
      const inputs = Object.fromEntries(parsed.data.inputs.map((spec) => [spec.name, `value-for-${spec.name}`]));
      const goal = buildGoal(parsed.data.goal, inputs);
      expect(goal.ok, `${name} ${goal.ok ? '' : goal.failure}`).toBe(true);
    }
  });

  it('parses every review decision', async () => {
    const { reviews } = await requestFiles();

    for (const name of reviews) {
      const parsed = ReviewDecision.safeParse(await read(name));
      expect(parsed.success, `${name} ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });

  it('gives a request that may write a goal that names where the form is, unless it exists to get stuck', async () => {
    const { goals } = await requestFiles();
    const withoutARoute: string[] = [];

    for (const name of goals) {
      const parsed = DiscoveryRequest.safeParse(await read(name));
      if (!parsed.success || parsed.data.allowWrites !== true) continue;

      // Nothing in MERIDIAN Core links to the sub account form, so a run told only to open an
      // account has no route to one. The first live write run spent itself finding that out.
      if (name.endsWith('.stuck.json')) {
        withoutARoute.push(name);
        expect(parsed.data.goal, name).not.toMatch(/\/subaccount/);
        continue;
      }
      expect(parsed.data.goal, name).toMatch(/\{\{inputs\.\w+\}\}\/subaccount|\/subaccount/);
    }

    // The exception is named, singular, and has to keep being deliberate. A stuck request
    // exists to prove the handoff, so its goal must stay routeless, and nothing else may
    // quietly become routeless by dropping the suffix into its file name.
    expect(withoutARoute).toEqual(['member.openSubAccount.stuck.json']);
  });
});
