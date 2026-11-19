# Feature Specification: Multiple Command Code profiles on one machine

**Feature Branch**: `001-cmd-profiles`

**Created**: 2026-11-06

**Status**: Draft

**Input**: User description: "Have a think how to make Command Code can run with multiple different profiles in a same machine. If we need any new code, the source code would sit in packages/cmd-profiles. So the final goal is 1. Setup Orca engine on a Mac Mini (shared machine) 2. User setup Orca on their own machine 3. Pair their own machine Orca to the shared Orca one. 4. Run Command Code with their own credentials separately (likely 5-10 users)."

**Scope note**: this revision replaces the earlier single-developer draft. The earlier framing — one developer keeping a `work` and a `personal` setup apart on a laptop — is now the *smallest* case of a shared-host scenario. The shared host is the requirement; the laptop case must still work, because that is how the feature will be developed.

## Objective

An operator runs one Mac Mini as a shared Orca host. Several people (5–10) each run Orca on their own
machine, pair it to the shared host, and start Command Code sessions that run *on the Mac Mini* while
authenticated *as themselves*. No two people share a credential, a session history, or a usage record,
and no person can read another's.

Today none of that is possible. Command Code keeps exactly one home, `~/.commandcode`, and resolves it
from the operating system user's home directory. That one directory holds the account credential
(`auth.json`), the model and provider choice (`config.json`), hooks (`settings.json`), installed
skills/commands/mods, session transcripts, and per-project caches. One machine therefore has exactly
one Command Code identity — so a shared host presently means a shared account.

Orca is the right foundation and already has the pieces: `orca serve` runs a headless runtime,
`serve service install` keeps it running, `environment add --pairing-code` pairs a client machine, and
`terminal create --command` runs a command on the host. What Orca does **not** have is a Command Code
account concept — its managed accounts cover Claude, Codex, OpenCode, and Devin only.

**Who it is for:** the operator of a shared host, and each of the people who pair into it.

## Clarifications

### Session 2026-11-06

- Q: On the shared Mac Mini, how are the 5–10 people represented at the operating-system level? → A: One shared macOS account, with profiles separating people inside it.
- Q: On the shared host, who should author a git commit? → A: Route by remote URL, as the machine already does; profiles never touch authorship.

### Session 2026-11-12

- Q: Is "non-interactively enough to script it" (FR-009) measurable? → A: No — restated as "without any interactive prompt", which is observable and testable.
- Q: Does FR-017 have coverage, or is attribution assumed? → A: Assumed. The feature keeps no ledger; attribution rests on vendor behaviour that must be verified on the host before FR-017 is called met.
- Q: Should FR-020's no-blocking claim be proven? → A: Yes — concurrent registry writes must be exercised rather than inferred from using an atomic rename.
- Q: Which spelling of "isolation boundary" is canonical? → A: "Isolation boundary" in prose; `ISOLATION_NOTICE` when naming the exported constant. Previously written four ways across four files.

### Session 2026-11-13

- Q: Should a profile share the machine's installed skills, mods and sub-agents, or start with none? → A: **Share them — this is a MUST, not a preference.** A profile that authenticates correctly but has no skills, no mods and none of the commands installed on the machine is a Command Code installation nobody can work in; users would abandon profiles rather than reinstall per identity.
- Q: Shared how — copied into each profile, or resolved from the real home? → A: Shared by symlinking the global content directories from the real home into the profile. A copy would drift, and a change on the machine must reach every profile without re-provisioning.
- Q: Which paths are shared and which stay per identity? → A: Shared: `skills`, `mods`, `agents`, `commands`, `references`, `docs`, `hooks`, `scripts` (under both `~/.commandcode/` and `~/.agents/`). Per identity: `auth.json`, `config.json`, `settings.json`, `sessions`, `projects`, `file-history`, `history.jsonl`, `trusted-hooks.json`. The split is enumerated per path (FR-027) rather than inferred.
- Q: What if two people need different versions of a skill? → A: Not supported — one machine, one skill version. Recorded as an accepted limitation, because silent per-profile divergence is the worse failure.
- Q: Should the feature name what to share, or what not to share? → A: **Name what not to share — share everything else.** Inverting the list keeps new capability directories working without an addition, at the cost of making the withheld list the entire safety boundary.

**What the inversion costs, stated plainly.** A denylist shares anything it does not name, so its
correctness depends on naming every path that must stay private — including paths that do not exist yet.
This machine demonstrates the exposure: the tool references `providers.json`, `keybindings.json`,
`auth.local.json`, `auth.staging.json` and `config.local.json`, and **none of the five exists on disk**.
Two are credentials. Under a denylist built from the files present today, both would be shared the moment
they are created. FR-027a and FR-027b exist for exactly this: withhold every environment variant, and
report paths the list does not mention.

**Verified before writing this:** Command Code follows a symlinked `skills` directory — a real session under a profile listed `demo · shared via symlink` from a directory that existed only in the real home. The mechanism works; the requirement is not speculative.

### Session 2026-11-13 (b)

- Q: How strict should a denylist be about entries it does not recognise? → A: **Pattern denylist only** — withhold by name pattern, share anything unmatched — **but the initial pattern set must be researched first**, not guessed.
- Q: FR-027d requires honouring the vendor's own sensitive-path list, and research found none exists. What should it say? → A: **Make it conditional** — bind only where the tool exposes such a source, and forbid reporting it met until then.
- Q: A `--no-share` flag appeared in the contract with no requirement behind it. Keep it? → A: **No — removed.** It was invented during planning, had no requirement, contradicted FR-023's unconditional MUST, and offered an escape hatch back to the bare profile this feature exists to prevent.
- Q: The concurrent-write edge case was described but no requirement enforced it. Where does it belong? → A: **FR-028**, with a companion FR-028a: several live sessions and an operator update must not corrupt shared content or leave a half-updated view presented as complete, and a write must not follow a link outward into the real home.
- Q: No success criterion would fail if the share step silently linked nothing. Add one? → A: **Yes — SC-015.** A provision that creates zero links on a machine with content must fail, not report success. SC-016 and SC-017 cover outward writes and concurrent consistency.
- Q: Does the research change the shape of that answer? → A: Yes, in three ways, each now a requirement: the pattern set is two-tier with a non-overridable core (FR-027); patterns match whole tokens and path segments rather than substrings (FR-027b); and per-profile state hiding *inside* a capability directory is addressed explicitly (FR-027c).

**What the research established, and why the requirements changed.** Two independent investigations — one reading the shipped binary, one surveying prior art — converged on the same conclusion: a bare pattern list is a blast-radius control, not a secrets control, and every tool that ships this problem solved enumerates rather than patterns. That does not make a pattern denylist wrong for this feature, but it does mean the patterns carry the whole safety burden, so four things were added:

- **`mods/.store/` is per-profile state inside a shared directory.** The tool writes per-mod runtime state under `mods/`, which the feature otherwise shares wholesale. A rule on the parent cannot express this; FR-027c exists for it. The mirror case: `mods/.registry/` holds *installed packages* and is genuine capability — so `mods/.*` is wrong in both directions.
- **`settings.json` carries an execution surface**, not just preferences: hook commands as absolute paths and permission grants. Sharing it would propagate one profile's shell hooks into another while the trust record stays per-profile — an incoherent state. It is withheld.
- **`providers.json` is identity even without raw secrets.** It holds provider endpoints and key *references*; sharing it while withholding the credential store yields a provider list pointing at keys that do not exist, or at another profile's. Withheld.
- **`*.jsonl` is the one extension worth matching on.** Transcripts, checkpoints, prompt logs and hook audits are all JSONL. No other extension glob is safe — `*.md` would destroy the entire capability set (`SKILL.md`, agent definitions, commands).

**Explicitly recorded as ambiguous, decided rather than assumed:** `mcp.json` may carry inline `env` secrets; it is withheld. `taste/` is simultaneously learned personal model and prompt-injected capability; it is withheld as personal state, and this is the one entry a user might argue should flip.

**A guard the research added rather than confirmed.** The tool carries its own internal notion of sensitive paths. FR-027d requires honouring that rather than duplicating it by hand — a vendor's own classification stays correct across releases in a way a hand-maintained list does not.

**Consequence of the first answer, stated plainly.** With one shared operating-system account, every profile
is owned by the same user, and file permissions cannot separate people: a `0600` credential is still
readable by any process running as that user. This was verified, not assumed — a `0600` file was read
from the same account without difficulty. The credential boundary is therefore **enforced by this
feature's launcher and by convention among cooperating colleagues, not by the operating system**. It
stops mistake, accident, and the ordinary use of the tool; it does not stop a colleague who
deliberately opens another person's files. `FR-005`, `FR-022` and `SC-002` are written to say exactly
that much and no more.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Each person runs as themselves on the shared host (Priority: P1)

A person pairs their own Orca to the Mac Mini and starts a Command Code session there. The session
runs with that person's credential. A second person does the same at the same time. Neither session
can read the other's credential, transcript, or usage records, and neither bills the other's account.

**Why this priority**: this is the entire reason the feature exists. If two people can reach each
other's credential, the shared host is unusable regardless of how convenient the launcher is.

**Independent Test**: provision two people, start a session as each, and confirm from inside each
session that the authenticated account is its own; then confirm from the host's filesystem that one
person's credential file is not readable by the other person's session.

**Acceptance Scenarios**:

1. **Given** two people provisioned on the shared host, **When** each starts a session, **Then** each
   reports its own account and writes history only to its own store.
2. **Given** one person's session is running, **When** the other person's session starts, **Then**
   neither session's credential or history is exposed to the other.
3. **Given** a session running as person A, **When** person B signs out and back in, **Then** person
   A's session continues uninterrupted.

---

### User Story 1b - A profile is as capable as the machine, not a bare installation (Priority: P1)

A person who has skills installed, sub-agents they wrote, and mods they depend on opens a session under
their profile and finds all of it exactly as it was. Their `work` and `personal` profiles are different
*identities*, not different *toolboxes*: what a person can do is a property of the machine, and who they
are is a property of the profile.

**Why this priority**: without this the feature is worse than useless. A profile that authenticates
correctly but has no skills, no mods, no sub-agents and none of the commands installed on the machine is
a Command Code installation nobody can work in, and people will abandon profiles rather than reinstall
everything per identity. Correct credentials on an unusable session is not a partial success — it is a
reason not to adopt the tool at all.

**Independent Test**: on a machine with skills, mods and sub-agents installed in the real home,
provision a profile and confirm from inside a session under it that the same skills are listed, the
same mods are loaded, the same sub-agents are available, and every installed command resolves — then
confirm the profile's credential is still its own.

**Acceptance Scenarios**:

1. **Given** a machine whose real home has installed skills, **When** a session runs under a profile,
   **Then** that session lists the same skills as a session under the real home.
2. **Given** a machine with installed mods and sub-agents, **When** a session runs under a profile,
   **Then** the mods are loaded and the sub-agents are available.
3. **Given** any package's commands and skills installed on the machine, **When** a session runs under a
   profile, **Then** those commands and skills resolve in it.
4. **Given** a skill added to the machine after a profile was provisioned, **When** that profile is
   next used, **Then** the new skill is available without re-provisioning.
5. **Given** two profiles in use, **When** either authenticates or signs out, **Then** neither
   profile's installed capabilities change and no other credential is affected.

---

### User Story 2 - The operator provisions and revokes people (Priority: P2)

The operator adds a person to the shared host, gives them a pairing code, and confirms the person can
run. When someone leaves, the operator revokes them and is certain their credential and history are
gone and that they can no longer start a session.

**Why this priority**: a shared host without revocation is a liability. This is the operational half
of the security promise.

**Independent Test**: provision a person, verify a working session, revoke them with the profile still
holding history, and confirm the revocation refuses until confirmation, then removes the credential
and history and refuses new sessions.

**Acceptance Scenarios**:

1. **Given** a new person, **When** the operator provisions them, **Then** a named profile exists that
   the person can authenticate against and use.
2. **Given** a person who must be removed, **When** the operator revokes them, **Then** their
   credential is deleted, and a later session under that profile is refused rather than silently
   running as someone else.
3. **Given** a person is revoked, **When** they attempt to start a session, **Then** the attempt fails
   with a message naming the missing profile, and no other profile is substituted.

---

### User Story 3 - A person pairs in and starts working (Priority: P3)

A person installs Orca on their own machine, pairs to the shared host with a code the operator gave
them, and starts a Command Code session on the host without a terminal ritual or a remembered flag.

**Why this priority**: it decides adoption. If a person needs three manual steps per session, the
shared host will not be used.

**Independent Test**: pair a clean client to the host, start a session in one step, and confirm the
step count and that the person's own profile was selected without an explicit argument.

**Acceptance Scenarios**:

1. **Given** a paired client, **When** the person starts a Command Code session, **Then** their own
   profile is selected without an explicit argument.
2. **Given** a paired client whose profile no longer exists on the host, **When** they start a
   session, **Then** it fails and names the missing profile.
3. **Given** a person with an explicit selection, **When** it disagrees with their default, **Then**
   the explicit selection wins and the session reports which profile it used.

---

### User Story 4 - The same mechanism works for one laptop (Priority: P4)

A single developer with no shared host keeps a `work` and a `personal` setup apart on their own
machine, using the same profiles, with no host-provisioning ceremony.

**Why this priority**: it is how the feature gets built and tested before a Mac Mini is involved, and
it is the majority of near-term use. It must not become a casualty of the shared-host design.

**Independent Test**: create two profiles on a laptop, authenticate each differently, and confirm the
isolation assertions of Story 1 hold without any shared-host setup.

**Acceptance Scenarios**:

1. **Given** two profiles on one laptop, **When** both are used in one repository, **Then** Story 1's
   isolation assertions hold.
2. **Given** a laptop user with one profile, **When** they use Command Code normally, **Then** nothing
   about their paths, prompts, or behaviour changes.

---

### Edge Cases

- **A profile with no installed content.** Before this requirement was written, a provisioned profile
  started with no skills, no mods and none of the machine's installed commands — and said nothing about
  it. A session that merely lacks every tool the person relies on must be treated as broken, not as a
  fresh install.
- **Shared content and concurrent writes.** A skill directory is shared, not copied. One person's
  session must not corrupt it for everyone, and an operator updating skills must not catch a live
  session half-updated.
- **The share target disappears.** Someone moves or deletes `~/.commandcode/skills` while profiles point
  at it. The profile must report that, not present an empty toolkit as normal.
- **The machine has nothing installed.** A clean Mac Mini with no skills and no mods must still
  provision working profiles — sharing nothing is not an error.
- **A tool introduces a new home-level directory.** Sharing is the default, so a new directory is shared
  automatically — which is right for capability and dangerous for state. The withheld list is the whole
  safety boundary, so a path the tool adds must be classified before it can hold anything sensitive, and
  an unclassified path that already exists must be reportable.
- **A credential appears in an environment this machine has never used.** The tool names credential files
  per environment. A machine holding only the production one must still withhold the staging and local
  ones, or the first time someone switches environment their credential is shared.
- **Per-profile state inside a shared directory.** A capability directory can contain runtime state that
  belongs to one person. Sharing the directory leaks the state; withholding it discards the capability.
  Both halves must be named, and a rule on the parent cannot express either.
- **A pattern that is too broad.** A `*key*` rule withholds `keybindings.json` and buys nothing; a `*.md`
  rule would withhold every skill, agent and command. Broad patterns are not conservative — they silently
  break the feature they are protecting.
- **One person wants a different version of a skill.** Sharing means one version for the machine. This
  is accepted and must be stated, because the alternative — silent divergence between profiles — is
  worse than a known limitation.
- **Concurrent load.** Five to ten people running agents at once on one Mac Mini contend for CPU,
  memory, disk, and network. A session that is merely slow must not be mistaken for a broken profile,
  and one person's runaway session must not make the host unusable for the rest.
- **Credential leakage through the filesystem.** Everyone's profile sits on one machine under one
  operating-system account, so no permission bit separates them: a colleague can read any other
  person's credential with an ordinary file read, and no setting of this feature can prevent that. The
  requirement is therefore to stop *accidental* exposure — a session inheriting the wrong home, a
  profile resolved to the wrong person, a credential copied into a shared location — and to state the
  limit rather than imply a guarantee.
- **A person trusts the boundary more than it deserves.** Someone assumes "separate profiles" means
  "nobody can see my key" and pastes a live credential into a shared host. The feature must say what it
  does and does not protect, at the point where a person first provisions.
- **The host reboots.** People have paired clients. After a reboot the runtime, and every profile
  mapping needed to route a person to their profile, must come back without each person re-pairing.
- **An interrupted provisioning.** A profile is created but authentication never completes. It must be
  visibly unusable, never reported as healthy.
- **One person, two devices.** The same person pairs from a laptop and a desktop. Both must reach the
  same profile; a second pairing must not fork their history or credential.
- **A person's session outlives revocation.** Revocation must stop new sessions; what happens to a
  running one must be defined rather than accidental.
- **A person leaves and their history is still wanted.** Revocation that must retain session history
  for audit is a different operation from revocation that erases it.
- **Pairing code leakage.** A code handed over in a chat channel must not grant indefinite access.
- **Disk exhaustion.** Ten people's transcripts, caches, and dependency trees on one machine fill it.
- **A shared-host user who never pairs.** Someone with a local terminal on the Mac Mini must be able
  to run their own profile without going through the pairing flow.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Multiple people MUST be able to run Command Code concurrently on one machine, each
  authenticated as a distinct account, from one installation.
- **FR-002**: Each profile MUST own its authentication credential, and authenticating or signing out
  of one profile MUST leave every other profile's credential intact.
- **FR-003**: Each profile MUST own its runtime configuration — model, provider, reasoning effort —
  with changes in one profile invisible to the others.
- **FR-004**: Each profile MUST own its session history, resume state, usage records, and per-project
  caches, such that no session can read another profile's history.
- **FR-005**: A profile's stored credential MUST NOT be readable through ordinary use of this feature by
  any other profile's session — the launcher MUST resolve each session's home to its own profile only.
  Given the single shared operating-system account, this is a boundary against mistake and accident,
  **not** against a colleague who deliberately inspects another person's files; the specification MUST
  NOT claim otherwise.
- **FR-006**: A person MUST be able to start a session under their profile with a single action from a
  paired client, without editing a shell startup file.
- **FR-007**: Profile selection MUST resolve deterministically when several sources could decide it,
  and any selection other than the caller's own default MUST be reported to that caller.
- **FR-008**: A session MUST fail, naming the missing profile, when its profile does not exist — it
  MUST NOT fall back to another profile or to the default.
- **FR-009**: The operator MUST be able to provision a profile without any interactive prompt, so that
  provisioning 5–10 people can be scripted, and MUST be able to confirm each one's authenticated
  account afterwards without reading that profile's files.
- **FR-010**: The operator MUST be able to revoke a profile, ending its ability to start sessions and
  removing its credential, and MUST be required to confirm when that profile still holds history that
  would be destroyed.
- **FR-011**: Revocation MUST distinguish removing access from erasing history, so an operator can
  keep a departed person's transcripts for audit without keeping their credential.
- **FR-012**: The host MUST return to a working state after a reboot without each person re-pairing.
- **FR-013**: An existing single-home installation MUST be adoptable as a profile with no loss of
  credential, configuration, hooks, installed content, or history, and a user who never creates a
  second profile MUST observe no change in paths, prompts, or behaviour.
- **FR-014**: A person MUST be able to use an existing Orca pairing rather than a new mechanism, and
  MUST NOT be required to hold an account on the shared host beyond what pairing provides.
- **FR-015**: Version-control author identity MUST be consistent with the repository being worked in
  rather than with the profile, so a commit in a work repository is authored as work regardless of
  which profile launched the session. The machine's existing remote-URL routing (`includeIf` rules in
  the home's version-control configuration) is the single source of authorship, and a profile MUST NOT
  override it.
- **FR-016**: A profile's Command Code version MUST be controllable independently, so provisioning a
  new person does not silently change the version an existing person runs.
- **FR-017**: Sessions MUST be attributable to a profile for accounting, so the operator can tell whose
  usage is whose without reading transcripts. Because this feature keeps no usage ledger of its own,
  attribution depends entirely on Command Code recording usage under the profile's home; that vendor
  behaviour MUST be verified on the host before this requirement is reported as met, and MUST NOT be
  claimed on the strength of the directory layout alone.
- **FR-018**: A profile whose credential is missing, expired, or unreadable MUST be diagnosable by name
  and failing element, without disclosing the credential value.
- **FR-019**: The feature MUST NOT require the vendor to change Command Code's published home
  directory, and MUST NOT rely on any unpublished vendor switch.
- **FR-020**: One person's active session MUST NOT prevent another person from starting, stopping, or
  reprovisioning their own profile. Concurrent writes to the profile registry MUST NOT lose an update,
  and this MUST be proven by exercising simultaneous writers rather than inferred from the write
  strategy.
- **FR-021**: An unattended or scripted session MUST select its profile non-interactively and MUST fail
  rather than substitute another profile.
- **FR-022**: The feature MUST state its Isolation boundary in user-facing terms — that a shared
  operating-system account makes profiles a guard against mistake rather than a defence against a
  determined colleague — and MUST NOT present file permissions as providing separation they cannot
  provide. The statement MUST be one constant emitted wherever a profile is created or reported on, so
  it cannot drift between surfaces or rot into a README nothing executes.
- **FR-023**: A session under a profile MUST have the same **installed capabilities** as a session
  under the machine's real home — skills, commands, sub-agents, references, hooks and mods MUST all
  resolve. A profile that authenticates correctly but starts empty is not a working profile.
- **FR-024**: The installed content MUST be **shared from the real home, not copied into each
  profile**, so that adding or updating a skill on the machine makes it available under every profile
  without re-provisioning any of them.
- **FR-025**: Installed content MUST be shared by continuing to resolve from the real home — the
  profile MUST NOT hold a private copy that can drift — such that a change made once on the machine is
  observable under a profile that was provisioned before the change.
- **FR-026**: The feature MUST share installed content **by default**, and MUST withhold by **name
  pattern**. Identity and state — the credential in every environment variant the tool recognises,
  model and provider configuration, session history, file history, per-project caches and trusted-hook
  records — MUST remain per profile and MUST NOT be shared, linked, or resolved from the real home.
- **FR-027**: The withheld patterns MUST be a **two-tier set**: a non-overridable core that always
  applies, and an operator-extensible layer that can only *add* patterns. The core MUST NOT be
  replaceable by a project-local file, because a single edited file that silently disables the
  protection is the failure this requirement exists to prevent. The effective set MUST be readable by
  an operator without starting a session.
- **FR-027a**: A path that carries a credential MUST be withheld **in every environment variant the
  tool recognises**, not only the one observed on a given machine. The tool names credential files per
  environment (production, staging, local) and per concern (auth, config); a machine typically holds
  only one of each, and withholding only those present would share the others the moment they are
  created.
- **FR-027b**: Because a pattern set shares whatever it does not match, the feature MUST compensate with
  three guards rather than treating the patterns as sufficient: **(i)** every path that was shared MUST
  be reportable, so a shared credential is discoverable rather than silent; **(ii)** the withheld set
  MUST be reconciled whenever the tool's home gains a new path, and paths present but unmatched MUST be
  reported; **(iii)** patterns MUST match whole name tokens and path segments, never free substrings, so
  that a name like `keybindings.json` is not withheld by a `*key*` rule while `credentials.json` is
  caught by a `credential`-token rule.
- **FR-027c**: The pattern set MUST cover identity and state that lives **inside a directory otherwise
  shared**. A capability directory can contain per-profile runtime state; withholding the directory
  wholesale would discard capability, and sharing it wholesale would leak state. Both halves MUST be
  addressed explicitly rather than by a single rule on the parent.
- **FR-027d**: Where the tool exposes its own notion of a sensitive or private path, that notion MUST be
  honoured as an additional source of withheld patterns rather than duplicated by hand. This is
  **conditional**: the tool as inspected exposes no such per-file classification — its only sensitive
  list is a permission allowlist for additional directories — so the requirement binds the moment such a
  source exists and MUST NOT be reported as met in the meantime.
- **FR-028**: Sharing MUST NOT make one profile's activity alter another's. Writing to a shared skill
  directory MUST be an administrative act on the machine, and a session under a profile MUST NOT be
  able to change another person's installed content through ordinary use. This includes the concurrent
  case: several sessions reading the same shared content at once, and an operator updating it while
  sessions are live, MUST NOT corrupt it or leave any session with a half-updated view that it presents
  as complete.
- **FR-028a**: A shared entry MUST be linked such that a writer cannot reach the real home through it by
  accident. A session that writes inside its own profile MUST NOT follow a link outward and modify the
  machine's content, and a write that would do so MUST fail rather than silently succeed.
- **FR-029**: The mechanism MUST survive the shared content being absent — a machine with nothing
  installed MUST still produce working profiles, and provision MUST NOT fail because there was nothing
  to share.
- **FR-030**: A profile whose installed content has become unreachable — its share target deleted or
  moved — MUST be diagnosable by name, and MUST NOT be reported as healthy while silently lacking the
  skills the operator believes are installed.

### Key Entities

- **Profile**: a named bundle of one identity, one runtime configuration, and the state derived from
  using that pair. Has a name, an owning person, an authenticated account, a location, an
  authentication status, and a last-used time.
- **Owner**: the person a profile belongs to. One owner may pair from several devices; one device may
  reach profiles for several owners only if that is deliberately granted.
- **Isolation boundary**: the limit of what a profile separates — one profile's state and credential
  from another's, within one shared operating-system account. It is a boundary against mistake and
  accident, and it is not, and MUST NOT be described as, a boundary against a colleague who chooses to
  read another person's files. Recorded here so the limit travels with the feature rather than being
  rediscovered by whoever trusts it. Implemented as a single exported constant named
  `ISOLATION_NOTICE`, so the words a user reads are the words a test asserts.
- **Shared host**: the machine running the runtime. Has a runtime identity, a lifecycle (boot, update,
  reboot), and a finite set of resources its sessions contend for.
- **Pairing**: the relationship between a client machine and the shared host that authorises reaching
  profiles there. Carries a lifetime, because a code that grants access forever is a liability.
- **Revocation record**: what was removed and what was retained when an owner was revoked —
  credential, history, or both.
- **Usage attribution**: the per-profile record of what was spent, sufficient to answer "whose usage"
  without opening a transcript.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Two people can run sessions concurrently on the shared host as different accounts, and
  100% of each session's history and usage records are attributable to the correct profile afterwards.
- **SC-002**: A session started under one profile cannot reach another profile's credential through
  ordinary use of the feature — verified by attempting it, not by inspecting permissions and assuming.
  Given the single shared operating-system account, this is measured as a bound on the feature's own
  behaviour and MUST NOT be reported as a security guarantee.
- **SC-003**: Revoking a person takes one operator action, and a session started afterwards fails
  within one attempt naming that profile.
- **SC-004**: After a host reboot, 100% of previously paired people start a working session without
  re-pairing.
- **SC-005**: Starting a session as a paired person costs one action and zero edits to shell startup
  files.
- **SC-006**: Provisioning a new person takes under five minutes and produces a session that reports
  the correct account on the first attempt.
- **SC-007**: A commit made in a work repository carries the work author regardless of which profile
  launched the session, verified by reading the commit back.
- **SC-008**: A single-profile user's configuration and state paths are unchanged from the current
  installation.
- **SC-009**: Ten concurrent sessions on one Mac Mini leave the host responsive, and one session's
  runaway work does not starve the others — measured, not assumed.
- **SC-010**: A session under a freshly provisioned profile lists exactly the same skills, mods and
  sub-agents as a session under the machine's real home — compared by name, counted, with zero
  differences in either direction.
- **SC-011**: A skill installed on the machine after a profile was provisioned is available in that
  profile's next session without re-provisioning it — verified by installing one and reading it back.
- **SC-012**: No file that carries identity — credential, model configuration, session history, or
  trusted-hook record — is reachable from another profile's session, and this is asserted by attempting
  the read rather than by inspecting the share configuration.
- **SC-013**: The enumerated per-profile (withheld) list is readable by an operator without starting a
  session, and every path present under the tool's home is either withheld or deliberately shared — so
  an unclassified addition is a visible finding rather than a silent default.
- **SC-014**: A credential file created in any environment variant the tool recognises is unreachable
  from another profile's session — asserted by creating the file and attempting the read, not by
  inspecting the list.
- **SC-015**: A profile provisioned on a machine that has installed content MUST contain at least one
  shared entry per root that has content, and a provision that creates **zero** links MUST fail rather
  than report success. Verified by provisioning against a machine with content and counting the links —
  a share step that silently does nothing is the specific failure this criterion exists to catch.
- **SC-016**: Writing inside a profile MUST NOT modify the machine's content through a shared entry:
  after a session writes to a path under its own profile, the real home's corresponding file is
  byte-identical to before.
- **SC-017**: With several profiles in use concurrently, a shared entry read by all of them remains
  consistent — no session observes a partially-written entry, and an operator update completes without
  any session reporting a corrupted or truncated read.

## Assumptions

- **The profile is the whole home directory, but not the whole *toolbox*.** Command Code resolves
  identity, configuration, installed content and history from one home directory and offers no
  per-concern override, so `HOME` relocation moves all of it. That is why installed content must be
  brought back deliberately (US1b, FR-023…FR-030): isolation of *identity* is the goal, and isolation
  of *capability* is an accident of the mechanism that has to be undone.
- **Profiles run concurrently, not by swapping a shared home in place.** Swapping files inside one
  home would make "several people at once" impossible and risks a half-written credential when two
  processes start together.
- **Orca is the transport and the lifecycle, not the account system.** Orca supplies pairing, the
  headless runtime, service supervision, and terminal execution. It does not model Command Code
  accounts, so this feature supplies that layer on top.
- **The shared host is administered by someone.** An operator exists who provisions and revokes.
- **The people sharing the host are cooperating colleagues.** Given one shared operating-system
  account, profiles are a boundary against mistake and accident. The spec does not claim they stop a
  colleague who deliberately reads another person's files, and a deployment that needs that property
  must instead give each person their own operating-system account.
- **A person's own machine keeps its own Orca.** The pairing carries reach, not identity.
- **The package lives at `packages/cmd-profiles`** as an npm workspace member, following the existing
  payload conventions: zero runtime dependencies for anything that only carries content, and the same
  Node floor as the workspace.
- **Naming.** "Profile" here means a named identity-plus-configuration bundle. It does not mean a
  Command Code session profile, a shell profile, an Orca profile, or a mod option.

## Appendix A: Verified constraints — Command Code (research, non-normative)

Established against the installed Command Code 1.87.3 on 2026-11-06. Recorded so a later revision can
re-check rather than re-argue.

- **The home directory is the only relocation lever.** A scan of every environment variable the binary
  reads found no home override, no `COMMANDCODE_HOME`, and no XDG fallback. The only `CMD_*` variables
  are `CMD_LOCAL_ONLY`, `CMD_ZDR`, `CMD_FLICKER_DEBUG`, and the `CMD_TEST_INJECT_*` test hooks.
  `getSettingsUserPath` resolves from the home directory directly.
- **An overridden home is honoured.** Pointing `HOME` at a temporary directory made the binary report
  that directory and create a fresh `.commandcode` inside it.
- **Separation actually works.** Under a fresh home the binary reported **Not authenticated** while
  the real home stayed authenticated — the isolation this feature needs is real, not theoretical.
- **The identity that does get lost is version control's.** The machine's author identity lives in
  `$HOME/.gitconfig` and nothing else — there is no `/etc/gitconfig` on the host tested. This is why
  `FR-015` exists: the home override must be paired with a deliberate decision about version-control
  identity, or it silently changes who authors commits. The decision recorded in this spec is to route
  authorship by repository remote URL, as the machine already does, and to keep profiles out of it.
- **A single shared account cannot be separated by file permissions.** A `0600` credential was read
  successfully by a process running as the same operating-system user. This is the factual basis for
  `FR-005`, `FR-022`, the `Isolation boundary` entity, and the reworded `SC-002`: with one shared
  account, profiles are a guard against mistake, not a defence against a determined colleague. Any
  later revision that wants the stronger property must move people to separate operating-system
  accounts — no amount of care inside this feature can substitute for that.
- **Project scope cannot substitute.** A repository's `.commandcode/` supplies content — skills,
  commands, mods — and a settings precedence of project-local, then project-shared, then user. It
  supplies no authentication or model layer, so it cannot separate two identities.
- **Update suppression is available.** `COMMANDCODE_SKIP_UPDATES` is honoured, which is how `FR-016`
  can be satisfied per profile without vendor changes.
- **A dormant environment-named credential variant exists.** The binary knows `auth.local.json` /
  `auth.staging.json` / `auth.json`, selected by an environment name. This is the vendor's deployment
  mechanism, not a user-facing profile switch, and relying on it would violate `FR-019`.

## Appendix B: Verified constraints — Orca (research, non-normative)

Established against the installed Orca on the same date, from `orca agent-context --json` (312
commands, schema v1).

- **The four steps in the goal are all first-class commands.** `orca serve` runs a headless runtime;
  `orca serve service install` installs it as a per-user background service that restarts itself;
  `orca environment add --name <name> --pairing-code <code>` saves a remote runtime from a pairing
  code; `orca agent launch --environment <selector>` runs against it.
- **Service lifecycle is per-user, and there is no multi-tenant concept.** `serve service install`
  writes a macOS LaunchAgent (a systemd user unit on Linux) *"for this profile"*, and a search of all
  312 command descriptions found no notion of multiple users, tenants, or per-user isolation. Whatever
  separation exists must therefore come from the operating system or from this feature — Orca will not
  supply it. This is the basis of the open question in `FR-005`.
- **Managed agent accounts exist, but not for Command Code.** `orca account add --agent
  claude|codex|opencode|devin` signs in and registers a managed account, and for OpenCode it does so
  *"using `opencode auth login --standalone` in private XDG directories"* — the closest existing
  precedent for this feature. Command Code is absent from that list, so the same idea must be built.
- **`account list` is deliberately host-local.** It rejects `--environment` and `--pairing-code` rather
  than ignoring them, so an operator must query the host itself to audit profiles. Relevant to `FR-009`
  and `FR-017`.
- **A remote terminal can run an arbitrary command.** `orca terminal create --command <text>` runs on
  the host, which is the surface a profile-aware launcher would use when it cannot extend
  `agent launch`.
- **Pairing carries no desktop control by default.** A paired client cannot drive the host's desktop
  unless the offer was created with `--grant-desktop-control`. Good default for a shared host.

## Appendix C: Prior art — `ocx` (research, non-normative)

`kdcokenny/ocx` (~980 stars, TypeScript, active 2026-11-05) manages *"portable, isolated profiles"* for
OpenCode. It is the closest published analogue and was examined at the user's request.

- **Its profiles are configuration directories**, not identities: `~/.config/ocx/profiles/<name>/`
  holding the agent's config, instructions, agents, commands, and skills.
- **It launches by setting a variable the vendor provides** — `env.OPENCODE_CONFIG_DIR =
  getProfileDir(name)`. That is the entire mechanism.
- **It explicitly does not do what our P1 requires.** Its own documentation states: *"Profiles share
  OpenCode credentials, session history, and other native data storage. They do not provide account
  separation or a security sandbox."*
- **Selection fails closed**: `--profile`, then `OCX_PROFILE`, then an explicitly set default, and
  *"No selection produces an error."* Precedent for `FR-008`.
- **Project-level profile selection was removed in its V2**: *"Project metadata never selects a
  profile."* Direct evidence against pinning a profile in a repository-committed file on a shared host.

**Why this matters for our design:** `ocx` is a *configuration* tool with a vendor-supplied config-dir
switch. This feature is an *identity* tool without one, on a shared host, for several people who must
not read each other's credentials. Copying `ocx` wholesale would produce a product that fails P1 while
looking complete. Its selection precedence and fail-closed behaviour are worth adopting; its isolation
model is exactly what we cannot accept.
