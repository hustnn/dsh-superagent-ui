/**
 * The mock's prompts, in upstream's shapes: three team sections, a team skill, an override of `runtime/worker` whose built-in
 * text changed since it was edited, a revision history, and the preview's composition by role.
 */
import { createHash } from 'node:crypto'
import type { PromptConfig, PromptPartText, PromptPreview, PromptsView } from '../upstream/types.ts'

const base = (text: string) => createHash('sha256').update(text).digest('base64url').slice(0, 16)

const BUILT_IN: Record<string, { roles: ('orchestrator' | 'worker')[]; text: string; placeholders?: string[] }> = {
  'runtime/shared': { roles: ['orchestrator', 'worker'], text: '# dsh-superagent\nYou are part of an agent that works for one team on one repository.' },
  'runtime/orchestrator': { roles: ['orchestrator'], text: '## Role: main Session\nYou route Triggers and talk to people. You never do the work yourself.' },
  'runtime/worker': { roles: ['worker'], text: '## Role: worker\nReport ready only after the change is pushed and the required checks passed; a draft stays unfinished.' },
  'runtime/subscriptions': { roles: ['orchestrator', 'worker'], text: '## subscriptions\nMessages on a subscribed Thread reach its Tickets without anyone mentioning the agent.' },
  'runtime/replies': { roles: ['orchestrator', 'worker'], text: '## replies\nReply in the conversation the request came from.' },
  'runtime/dispatch': { roles: ['orchestrator'], text: '## dispatch\nRoute explicit candidates with orchestrator_route.' },
  'runtime/work': { roles: ['worker'], text: '## work\nConfirm a new request once, then work quietly until there is a result or a question.' },
  'runtime/admission': { roles: ['orchestrator'], text: '## admission\nJudge every enabled rule exactly once for an inferred candidate.' },
  'runtime/handoff/orchestrator': { roles: ['orchestrator'], text: '## handoff\nForward a worker\'s question unchanged.' },
  'runtime/handoff/worker': { roles: ['worker'], text: '## handoff\nAsk one concrete question through human_action.' },
  'runtime/environment': { roles: ['orchestrator', 'worker'], text: 'Execution environment:\n{variables}', placeholders: ['{variables}'] },
  'runtime/policy': { roles: ['orchestrator'], text: '## Policy\nPolicy version {version}; accept mode {mode}. Rules:\n{rules}', placeholders: ['{version}', '{mode}', '{rules}'] },
  'runtime/policy/none': { roles: ['orchestrator'], text: '## Policy\nPolicy version {version}; accept mode {mode}. No rule is enabled.', placeholders: ['{version}', '{mode}'] },
  'skill/feishu': { roles: ['orchestrator', 'worker'], text: '# Feishu\nRead messages with lark-cli; reply in the topic.' },
  'skill/github': { roles: ['orchestrator', 'worker'], text: '# GitHub\nRead Issues, pull requests, reviews and CI with gh.' },
}
/** The `runtime/worker` text the team's override was edited from, before an upgrade changed it. */
const OLD_WORKER = '## Role: worker\nReport ready only after the change is pushed and checks have started.'

const DEFAULTS: PromptConfig = {
  communication: 'Begin every GitHub message with: "This is by an automated agent, not a human."\nMessage only when a person must act or can use a result.',
  scope: 'A local change goes as far as a reviewable pull request.\nA change that needs a design decision stops with one concrete question.',
  delivery: 'Every pull request states the problem, the change and how it was verified.',
  skills: {},
}

export interface MockPrompts {
  versions: { revision: number; previousRevision: number | null; savedAt: string; source: string; config: PromptConfig }[]
  /** The revision each live Session last used. */
  sessions: { sessionId: string; revision: number }[]
}

export function seedPrompts(now: number): MockPrompts {
  const day = (days: number) => new Date(now - days * 86_400_000).toISOString()
  const v10: PromptConfig = { ...DEFAULTS, skills: { identities: '---\nname: identities\ndescription: Which Feishu user is which GitHub account.\n---\n- 周舟 (ou_zhouzhou) is GitHub @zhouzhou\n- 李雷 (ou_lilei) is GitHub @lilei' } }
  const v11: PromptConfig = { ...v10, delivery: `${DEFAULTS.delivery}\nA UI change is not ready without a real before-and-after screenshot.\nNever enable auto-merge as acme-agent.`,
    overrides: { 'runtime/worker': { text: '## Role: worker\nReport ready only after the change is pushed and checks have started.\nMark a draft pull request as unfinished in its description.', base: base(OLD_WORKER) } } }
  const v12: PromptConfig = { ...v11, communication: `${DEFAULTS.communication}\nChat replies are one sentence by default and never longer than 100 words.\nacme-review-bot is an automated reviewer; answer each of its threads at most three rounds per pull request.` }
  return {
    versions: [
      { revision: 10, previousRevision: 9, savedAt: day(6), source: 'panel', config: v10 },
      { revision: 11, previousRevision: 10, savedAt: day(2), source: 'tool', config: v11 },
      { revision: 12, previousRevision: 11, savedAt: day(0.4), source: 'panel', config: v12 },
    ],
    sessions: [{ sessionId: 'orchestrator', revision: 12 }, { sessionId: 'worker-tk_142', revision: 12 }, { sessionId: 'worker-tk_133', revision: 11 }],
  }
}

const changedNames = (before: PromptConfig | undefined, after: PromptConfig): string[] => {
  if (!before) return []
  const entries = (value: PromptConfig): Record<string, string> => ({ communication: value.communication, scope: value.scope, delivery: value.delivery,
    ...Object.fromEntries(Object.entries(value.skills).map(([name, text]) => [`skill/${name}`, text])),
    ...Object.fromEntries(Object.entries(value.overrides ?? {}).map(([part, override]) => [part, JSON.stringify(override)])) })
  const a = entries(before), b = entries(after)
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(name => a[name] !== b[name])
}

export function promptsView(prompts: MockPrompts, revision?: number): PromptsView {
  const latest = prompts.versions.at(-1)!
  const shown = prompts.versions.find(version => version.revision === revision) ?? latest
  const defaultChanged = Object.entries(shown.config.overrides ?? {}).flatMap(([part, override]): PromptsView['defaultChanged'] => {
    const now = BUILT_IN[part]
    if (!now) return [{ part, ...override.base ? { base: override.base } : {}, removed: true as const }]
    if (!override.base || override.base === base(now.text)) return []
    return [{ part, base: override.base, ...override.base === base(OLD_WORKER) ? { previous: OLD_WORKER } : {} }]
  })
  return {
    current: shown, defaults: DEFAULTS, sections: ['communication', 'scope', 'delivery'], builtin: ['feishu', 'github'],
    parts: Object.entries(BUILT_IN).map(([key, part]) => ({ key, roles: part.roles, text: part.text, ...part.placeholders ? { placeholders: part.placeholders } : {}, base: base(part.text) })),
    defaultChanged, revision: latest.revision, sessions: prompts.sessions,
    revisions: [...prompts.versions].reverse().map(({ config, ...version }) =>
      ({ ...version, changed: changedNames(prompts.versions.find(item => item.revision === version.previousRevision)?.config, config) })),
    next_offset: null,
  }
}

export class PromptRefusal extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

function validate(value: unknown): PromptConfig {
  const config = value as PromptConfig | null
  if (!config || typeof config.communication !== 'string' || typeof config.scope !== 'string' || typeof config.delivery !== 'string' || typeof config.skills !== 'object')
    throw new PromptRefusal(400, 'Invalid prompts: communication, scope, delivery, skills')
  for (const name of Object.keys(config.skills)) if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new PromptRefusal(400, `Invalid skill name: ${name}`)
  for (const [part, override] of Object.entries(config.overrides ?? {})) {
    const now = BUILT_IN[part]
    if (!now) continue
    for (const placeholder of now.placeholders ?? []) if (!override.text.includes(placeholder)) throw new PromptRefusal(400, `The override of ${part} must keep ${placeholder}`)
  }
  return config
}

export function savePrompts(prompts: MockPrompts, body: unknown): { revision: number } {
  const { config, baseRevision } = (body ?? {}) as { config?: unknown; baseRevision?: unknown }
  const latest = prompts.versions.at(-1)!
  if (baseRevision !== latest.revision) throw new PromptRefusal(409, 'Prompts changed. Reload before saving.')
  const valid = validate(config)
  const revision = latest.revision + 1
  prompts.versions.push({ revision, previousRevision: latest.revision, savedAt: new Date().toISOString(), source: 'panel', config: valid })
  return { revision }
}

/** The parts of each role in upstream's order (`promptParts`), with the team's text in place of what it overrides. */
export function preview(value: unknown): PromptPreview {
  const config = validate(value)
  const fixed = (key: string, name = key): PromptPartText => ({ name, kind: 'fixed', key, text: config.overrides?.[key]?.text ?? BUILT_IN[key]!.text })
  const headings = { communication: 'Communication', scope: 'Ticket scope', delivery: 'Delivery requirements' } as const
  const team = (name: keyof typeof headings): PromptPartText => ({ name, kind: 'team', heading: `## ${headings[name]}`, text: config[name] ? `## ${headings[name]}\n${config[name]}` : '' })
  const role = (which: 'orchestrator' | 'worker'): PromptPartText[] => [
    fixed('runtime/shared'), fixed(`runtime/${which}`), team('communication'), team('scope'), team('delivery'),
    fixed('runtime/subscriptions'), fixed('runtime/replies'), fixed(which === 'orchestrator' ? 'runtime/dispatch' : 'runtime/work'),
    ...which === 'orchestrator' ? [fixed('runtime/admission')] : [], fixed(`runtime/handoff/${which}`, 'runtime/handoff'),
    { name: 'runtime/environment', kind: 'generated' as const, key: 'runtime/environment', text: 'Execution environment:\nDSH_SUPERAGENT_GITHUB_REPOSITORY=acme/harness-app' },
    ...which === 'orchestrator' ? [{ name: 'runtime/policy', kind: 'generated' as const, key: 'runtime/policy', text: '## Policy\nPolicy version p7c1e93a2b4d; accept mode observe.' }] : [],
  ].filter(part => part.text)
  const orchestrator = role('orchestrator'), worker = role('worker')
  return { orchestrator: orchestrator.map(part => part.text).join('\n\n'), worker: worker.map(part => part.text).join('\n\n'), parts: { orchestrator, worker },
    skills: { ...config.skills }, scope: 'Team sections, skills, and overrides of built-in parts.' }
}
