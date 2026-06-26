# Spec: Skills for Review Agents

**Feature:** A1 — Skills Lab (storage, editor, agent binding, import, prompt injection)  
**Status:** planning (updated to match design v2 — 2026-06-24)  
**Scope:** `server/`, `client/`, `reviewer-core/` (read-only: prompt already ready)

---

## 0. Що вже є (не чіпати)

| Артефакт | Стан |
|---|---|
| `skills`, `skill_versions`, `agent_skills` DB tables | ✅ schema exists |
| `Skill`, `SkillType`, `SkillSource`, `AgentSkillLink` в shared contracts | ✅ |
| `AgentsRepository.linkedSkills / setSkills / linkSkill / unlinkSkill` | ✅ |
| `GET/POST /agents/:id/skills` routes | ✅ |
| `reviewer-core/src/prompt.ts` — `parts.skills?: string[]` → `## Skills / rules` | ✅ |
| i18n: `client/messages/en/skills.json` та agent tabs keys | ✅ |

Що **відсутнє** — детально нижче.

---

## 1. Серверний модуль `modules/skills/`

### 1.1 API endpoints

```
GET    /skills                    — список (workspace-scoped)
GET    /skills/:id                — один скіл
POST   /skills                    — створити (source: manual)
PUT    /skills/:id                — оновити (name / description / type / body / enabled)
DELETE /skills/:id                — видалити

GET    /skills/:id/stats          — usage metrics (agents count, pull freq, accept rate, findings 30d)

POST   /skills/import/file        — parse .md або .zip → preview, без persist і без виконання
POST   /skills/import/url         — fetch server-side → preview, без persist
GET    /skills/community          — (mock/stub) список community skills
```

**Не змінювати:** `GET /agents/:id/skills` і `POST /agents/:id/skills` вже є у `modules/agents/routes.ts`.

### 1.2 Файли модуля

```
server/src/modules/skills/
  repository.ts   — CRUD + stats query (workspace-scoped)
  service.ts      — бізнес-логіка: create, update (з versioning), import parse
  routes.ts       — Fastify plugin (Zod schemas + type-provider-zod)
```

Реєстрація в `modules/index.ts`: один import + один запис.

### 1.3 repository.ts — ключові методи

```ts
list(workspaceId): Promise<Skill[]>
getById(workspaceId, id): Promise<Skill | undefined>
insert(values: InsertSkill): Promise<Skill>
update(workspaceId, id, patch: UpdateSkill): Promise<Skill | undefined>
deleteById(workspaceId, id): Promise<boolean>
getStats(workspaceId, skillId): Promise<SkillStats>
```

**Versioning при оновленні body:**
При кожній зміні `body`:
1. Вставити поточне тіло в `skill_versions(skillId, version, body)` (immutable snapshot).
2. `skills.version++`, `skills.body = newBody`.

**SkillStats** (для Stats tab):
```ts
interface SkillStats {
  agentsCount: number;        // кількість агентів, що мають цей скіл linked
  pullFrequencyPct: number;   // % runs де цей скіл був активний (30d)
  acceptRatePct: number;      // % findings від цього скіла, що прийняті (30d)
  findings30d: number;        // всього findings з цим скілом за 30 днів
  agentsUsing: { id: string; name: string }[];   // агенти що використовують скіл
  findingsByCategory: { category: string; count: number; cost: number }[];
}
```

> Stats — best-effort: якщо таблиці з агрегатами ще немає, повертати заглушку з нулями.
> Реальні дані підʼєднуються пізніше (A-stats lesson). У поточній версії: `agentsCount` = JOIN
> з `agent_skills`, решта = 0 / порожні масиви.

### 1.4 Import flow (server-side)

`POST /skills/import/file` — multipart, один файл:
- `.md` → декодувати текст, витягти перший `# heading` як name (fallback: filename без `.md`)
- `.zip` → відкрити архів, знайти перший `.md` файл, решту ігнорувати.
  **Виконувані файли (`.sh`, `.js`, `.py`, `.ts`, etc.) — ігнорувати повністю, не читати, не логувати їх вміст.**
- Повернути `{ name, body, type: 'custom', source: 'manual' }` — **лише preview, без збереження**

`POST /skills/import/url` — `{ url: string }`:
- Fetch server-side (ніколи client-side → захист від SSRF через allow-list або параметр)
- Повернути preview: `{ name, body, source: 'imported_url', enabled: false }`
- Зберегти лише після явного POST `/skills` з preview-даними

### 1.5 Zod schemas

```ts
const CreateSkillBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  type: SkillType,
  body: z.string().min(1),
  source: SkillSource.default('manual'),
  enabled: z.boolean().default(true),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});
```

### 1.6 agent_skills — enabled per link

**Потрібна міграція:** додати `enabled boolean NOT NULL DEFAULT true` до `agent_skills`.
Після правки `server/src/db/schema/agents.ts` → `pnpm db:generate`.

`linkedSkills` при завантаженні для промпта: фільтрувати де `agent_skills.enabled = true AND skills.enabled = true`.

---

## 2. Run-executor — ін'єкція skills у промпт

Файл: `server/src/modules/reviews/run-executor.ts`, метод `runOneAgent`.

Після розв'язання LLM провайдера, перед `reviewPullRequest(...)`:

```ts
const linkedSkills = await this.agents.linkedSkills(agent.id);
const enabledSkillBodies = linkedSkills
  .filter(l => l.enabled && l.skill.enabled)
  .map(l => l.skill.body);

runLog.info(
  `Skills: ${enabledSkillBodies.length} of ${linkedSkills.length} linked skill(s) enabled`,
);
```

Передати у `reviewPullRequest`:
```ts
...(enabledSkillBodies.length > 0 ? { skills: enabledSkillBodies } : {}),
```

`prompt_assembly.skills` заповниться автоматично через `outcome.assembly` (reviewer-core вже це робить).

---

## 3. Client — hooks (`lib/hooks/skills.ts`)

```ts
useSkills()                    // GET /skills
useSkill(id)                   // GET /skills/:id
useSkillStats(id)              // GET /skills/:id/stats
useCreateSkill()               // POST /skills
useUpdateSkill()               // PUT /skills/:id
useDeleteSkill()               // DELETE /skills/:id
useAgentSkills(agentId)        // GET /agents/:id/skills
useSetAgentSkills()            // POST /agents/:id/skills { skill_ids }
useImportSkillFile()           // POST /skills/import/file (multipart)
useImportSkillUrl()            // POST /skills/import/url
```

Реекспортувати `Skill`, `SkillType`, `SkillSource` у `lib/types.ts`.

---

## 4. NAV

Оновити `client/src/vendor/ui/nav.ts`:

```ts
// WORKSPACE — без змін (Pull Requests залишається)
// Agents перенести у SKILLS LAB

{
  section: "SKILLS LAB",
  items: [
    { key: "skills",          label: "Skills",          icon: "Sparkles",   href: "/skills",          gKey: "s" },
    { key: "agents",          label: "Agents",          icon: "Cpu",        href: "/agents",          gKey: "a" },
    { key: "conventions",     label: "Conventions",     icon: "List",       href: "/conventions" },
    { key: "eval-dashboard",  label: "Eval Dashboard",  icon: "BarChart2",  href: "/eval" },
  ],
},
```

> `Conventions` і `Eval Dashboard` — існуючі пункти, просто переміщені в нову секцію.

---

## 5. Client — Skills page

**Route:** `/skills`

```
client/src/app/skills/
  page.tsx                     — Server Component (breadcrumb: Skills Lab > Skills)
  _components/
    SkillsPage/
      SkillsPage.tsx           — Client Component (2-column layout)
      SkillList.tsx            — вертикальний список SkillCard
      SkillCard.tsx            — картка в списку
      SkillDetailPanel.tsx     — права панель з вкладками
      _components/
        ConfigTab/
          ConfigTab.tsx
          styles.ts
        PreviewTab/
          PreviewTab.tsx
          styles.ts
        StatsTab/
          StatsTab.tsx
          styles.ts
        VersionsTab/
          VersionsTab.tsx
      AddSkillDrawer.tsx       — drawer: File / URL / Community tabs
      constants.ts
      styles.ts
      index.ts
```

### 5.1 Загальний layout

```
[breadcrumb: Skills Lab > Skills]                    [+ Add Skill ▾]

┌─────────────────────────────┐  ┌────────────────────────────────────────────┐
│ [Search skills…]            │  │ ✦ pr-quality-rubric  [rubric] [→ v5]  [Run on evals] │
│                             │  │ Config | Preview | Evals | Stats | Versions│
│ SkillCard (pr-quality…) ☑  │  │                                            │
│ SkillCard (no-then-chains)☑ │  │  (вміст активної вкладки)                 │
│ SkillCard (secret-leak…)  ☑ │  │                                            │
│ SkillCard (lethal-trif…)  ☑ │  │                                            │
│ SkillCard (phantom-api…)  ☐ │  │                                            │
│ SkillCard (test-coverage) ☑ │  │                                            │
└─────────────────────────────┘  └────────────────────────────────────────────┘
```

### 5.2 SkillCard (лівий список)

```
┌──────────────────────────────────────────┬───┐
│ ✦  pr-quality-rubric               [toggle ON]│
│    Rubric for evaluating overall PR …         │
│    [rubric]  [Manual]                         │
│    3 agents   71% pull   74% accept           │
└───────────────────────────────────────────────┘
```

- Іконка sparkle + name монопросторовим шрифтом
- Enabled toggle (PUT /skills/:id `{ enabled }`)
- Опис (truncate 2 рядки)
- Type badge: `rubric` (blue) / `convention` (green) / `security` (red) / `custom` (gray)
- Source badge: `Manual` / `Extracted` / `Community` / `Imported`
- Stats рядок: `N agents  X% pull  Y% accept` (з `useSkillStats` або вбудовано в `useSkills`)
- Виділений стан (selected) при кліку → показати детальну панель

### 5.3 SkillDetailPanel — header

```
✦  pr-quality-rubric   [rubric]  [→ v5]          [▶ Run on evals]
Config | Preview | Evals | Stats | Versions
```

- `→ v5` — version badge (кількість версій із `skill.version`)
- `Run on evals` — кнопка (scope A5, для цієї фічі — заглушка або disabled)

### 5.4 Config tab

```
Configuration        [→ v5]                       Enabled [toggle]

Name *
[pr-quality-rubric                              ]

Description
[Rubric for evaluating overall PR quality …    ]

Type
[rubric                                       ▾]

Skill body *
┌ pr-quality-rubric.md  [unsaved]          166 tokens ┐
│  1  # PR Quality Rubric                             │
│  2                                                  │
│  3  Evaluate the pull request against …             │
│  …  (monaco editor / code textarea)                 │
└─────────────────────────────────────────────────────┘

[Save]  [Cancel]
```

- **Name**, **Description**, **Type** — звичайні поля форми
- **Skill body** — code editor блок:
  - Header рядок: filename (`${name}.md`), badge `unsaved` якщо є незбережені зміни, `N tokens` (підрахунок символів / 4 — апроксимація)
  - `<textarea>` або Monaco Editor (якщо є у vendored UI) з monospace шрифтом, line numbers
- При збереженні `body`: `PUT /skills/:id { body }` — сервер автоматично створює нову версію в `skill_versions`
- Description hint під полем: `"Describe the skill directively — the agent reads this as an instruction."`

### 5.5 Preview tab

```
Preview
Rendered as the reviewing agent receives it.

┌─────────────────────────────────────────────┐
│  PR Quality Rubric                          │
│                                             │
│  Evaluate the pull request against the      │
│  following dimensions. For each, return a   │
│  finding only when the issue is **worth     │
│  the author's time** …                      │
│                                             │
│  Correctness                                │
│  • Does the change do what the PR …         │
│  • Are edge cases (empty input, nulls…      │
│                                             │
│  Security                                   │
│  • Any secrets, tokens, or credentials…     │
│  …                                          │
└─────────────────────────────────────────────┘
```

- Рендер `skill.body` як Markdown (використати існуючий markdown renderer у vendored UI або react-markdown)
- White/light-surfaced card на темному фоні (як на дизайні)
- Subtitle: "Rendered as the reviewing agent receives it."

### 5.6 Stats tab

```
┌──────────────┐ ┌───────────────┐ ┌──────────────┐ ┌──────────────┐
│  USED BY     │ │ PULL FREQUENCY│ │  ACCEPT RATE │ │FINDINGS (30D)│
│  3 agents    │ │    71%        │ │  74%  [◉]    │ │     96       │
└──────────────┘ └───────────────┘ └──────────────┘ └──────────────┘

┌─────────────────────────────────┐  ┌──────────────────────────────┐
│ AGENTS USING THIS SKILL         │  │ FINDINGS BY CATEGORY         │
│                                 │  │                              │
│ ⚙ Security Reviewer      Open   │  │  [donut chart]               │
│ ⚙ Performance Reviewer   Open   │  │  • security  $52.00          │
│ ⚙ Custom Mentor          Open   │  │  • bug       $28.00          │
└─────────────────────────────────┘  │  • perf      $16.00          │
                                     │  • style     $12.00          │
                                     └──────────────────────────────┘
```

- 4 metric cards (кути з тінню)
- ACCEPT RATE має маленький donut gauge
- Agents list: клік "Open" → перейти на `/agents/:id`
- Findings by category: donut chart з легендою і сумами
- Дані з `GET /skills/:id/stats` → `useSkillStats(id)`
- **MVP:** `agentsUsing` реальний (JOIN agent_skills), решта — заглушки `0 / []`

### 5.7 Versions tab (MVP)

Список snapshot'ів з `skill_versions`:
```
v5  2026-06-24  [current]
v4  2026-06-22
v3  2026-06-20
```
Клік → показати body того version (readonly).

### 5.8 AddSkillDrawer

Відкривається кнопкою `+ Add Skill ▾` (dropdown або одразу drawer).

**Tabs: File | URL | Community**

**File:**
- Drag-and-drop або `<input type="file" accept=".md,.zip">`
- POST `/skills/import/file` → preview (name, body перші 300 символів)
- Поля підтвердження: name (pre-filled), description, type
- Кнопка "Import skill" → POST `/skills` → invalidate, close
- Попередження: "This skill's body is treated as data — it is never executed. Review it before enabling."

**URL:**
- Text input
- POST `/skills/import/url` → preview
- Зберігається з `enabled: false` (needs vetting)
- Попередження: "Stored disabled until you vet and enable it."

**Community (stub MVP):**
- Hardcoded список 3–5 скілів (або GET `/skills/community`)
- Search filter (client-side)
- "Import" → POST `/skills`

---

## 6. AgentEditor — вкладка Skills

### 6.1 Додати вкладку у constants.ts

```ts
// client/src/app/agents/[id]/_components/AgentEditor/constants.ts
export const TABS: readonly EditorTab[] = [
  { key: "config",  labelKey: "editor.tabs.config",  icon: "Settings"  },
  { key: "skills",  labelKey: "editor.tabs.skills",  icon: "Sparkles"  },
  { key: "evals",   labelKey: "editor.tabs.evals",   icon: "FlaskConical" },
  { key: "stats",   labelKey: "editor.tabs.stats",   icon: "BarChart2" },
  { key: "ci",      labelKey: "editor.tabs.ci",      icon: "GitBranch" },
];
```

### 6.2 Файли

```
AgentEditor/_components/
  SkillsTab/
    SkillsTab.tsx
    SkillRow.tsx      — один рядок (drag handle, checkbox, name, type badge)
    styles.ts
    index.ts
```

### 6.3 SkillsTab layout (відповідно до дизайну Agent editor)

```
Skills   [3 of 6 enabled]              [Filter skills…]

Order matters — earlier skills appear earlier in the assembled prompt. Drag to reorder.

⠿  ☑  pr-quality-rubric          [rubric]
⠿  ☐  no-then-chains             [convention]
⠿  ☑  secret-leakage-gate        [security]
⠿  ☑  lethal-trifecta            [security]
⠿  ☐  phantom-api-gate           [security]
⠿  ☐  test-coverage-nudge        [custom]
```

### 6.4 Логіка

- `useAgentSkills(agentId)` → список linked skills з `order`
- Toggle (enabled per link) → `POST /agents/:id/skills { skill_id, enabled }` (потребує оновлення endpoint або PUT)
- Reorder (drag-and-drop) → `POST /agents/:id/skills { skill_ids: [...inOrder] }`
- Кнопка "+ Add skill" → sheet/modal зі списком всіх skills workspace (не прив'язаних), вибрати → link

> **Примітка:** `agent_skills.enabled` потребує міграції (§1.6).

---

## 7. Нові агенти в seed

Додати у `server/src/db/seed.ts` після існуючих агентів:

### 7.1 Test Quality Reviewer

```ts
name: 'Test Quality Reviewer',
description: 'Checks for uncovered branches, missing corner cases, over-mocking, and flakey patterns.',
provider: DEFAULT_PROVIDER,
model: DEFAULT_MODEL,
systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,  // у seed-prompts.ts
```

Seed skills + links:
- `test-coverage-nudge` (type: custom) — тіло з правилами перевірки тестів
- `phantom-api-gate` (type: security) — тіло перевіряє зміни підпису роутів

### 7.2 API Contract Reviewer

```ts
name: 'API Contract Reviewer',
description: 'Detects breaking changes to route signatures, response shapes, and status codes.',
provider: DEFAULT_PROVIDER,
model: DEFAULT_MODEL,
systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
```

Seed skills + link: `api-contract-gate` (type: rubric).

**Хоча б один скіл для кожного агента — через import flow** (показати у відео).

---

## 8. Контрольний експеримент

| Сценарій | Без скілів | Зі скілами |
|---|---|---|
| PR: test лише happy-path | APPROVE | FLAG: непокрита гілка + missing boundary case |
| PR: зміна route signature | APPROVE | FLAG: breaking change (видалено поле з response) |

**Трасування:** Run Trace → `prompt_assembly.skills` → видно блок `## Skills / rules`.  
Вимкнений скіл → секції немає.

---

## 9. Definition of Done

- [ ] `GET/POST/PUT/DELETE /skills` — коректні DTOs, workspace-scoped
- [ ] `GET /skills/:id/stats` — agentsCount реальний; решта 0 (MVP)
- [ ] `POST /skills/import/file` — .md і .zip (тільки перший .md, виконувані ігноруються)
- [ ] `POST /skills/import/url` — зберігає disabled, повертає preview
- [ ] agent_skills.enabled міграція застосована
- [ ] Run-executor: `skills:` в `reviewPullRequest`, `prompt_assembly.skills` заповнений
- [ ] Вимкнений скіл (global або per-link) → НЕ в промпті
- [ ] Skills page: список карток зі stats + детальна панель з 5 вкладками
- [ ] Config tab: форма + code editor з token count + unsaved badge
- [ ] Preview tab: рендер markdown
- [ ] Stats tab: 4 метрики + agents list + findings chart (MVP з частиною реальних даних)
- [ ] Versions tab: список snapshot'ів
- [ ] AddSkillDrawer: File tab + URL tab + Community stub
- [ ] AgentEditor Skills tab: прив'язка, toggle, drag reorder
- [ ] NAV: SKILLS LAB секція з 4 пунктами
- [ ] Два нові агенти після `pnpm db:seed` зі skills linked
- [ ] Контрольний експеримент відтворюється
- [ ] `pnpm typecheck` без помилок (server + client)

---

## 10. Порядок реалізації

1. **Міграція** — `agent_skills.enabled` (schema → `pnpm db:generate` → `pnpm db:migrate`)
2. **`modules/skills/`** — repository → service → routes → register в `modules/index.ts`
3. **Run-executor** — wire-in linkedSkills → `skills:` param
4. **Client hooks** — `lib/hooks/skills.ts`
5. **NAV** — SKILLS LAB секція (4 items)
6. **Skills page** — SkillList + SkillCard + SkillDetailPanel (Config + Preview tabs у першу чергу)
7. **Stats tab** — 4 metric cards + agents list (chart — MVP)
8. **Versions tab** — список snapshots
9. **AddSkillDrawer** — File tab (MVP), URL tab, Community stub
10. **AgentEditor Skills tab** — SkillsTab + SkillRow + drag-reorder
11. **Seed** — нові агенти + skills bodies
12. **Контрольний експеримент**
