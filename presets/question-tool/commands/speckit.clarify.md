> **This wrapper supersedes the questioning loop in the command below.**
>
> Where this command would present a clarification as a Markdown table, a `**Question:**` line, or
> a `**Suggested:**` line, then "wait for user response", ask it with the question tool instead —
> the interactive multiple-choice prompt this harness exposes. That tool call **replaces** the
> rendering described below; everything else (the ambiguity scan, the taxonomy, the caps, the
> integration and validation steps) still applies unchanged.
>
> Why: a decision written as prose can end the turn with the decision still open, and the user has
> to notice and re-prompt. A tool call is a real stop that cannot be silently skipped.
>
> Rules for the call:
>
> 1. **One question per call, in sequence.** The command asks up to five clarifications; ask them
>    one at a time, highest impact first, and fold each answer into the spec before asking the
>    next. Never batch the queue into one call — the answer to the first routinely changes whether
>    the second is still worth asking.
> 2. **Keep the question text interrogative and self-contained.** The prompt must read as a real
>    question that makes sense to someone who has never seen Spec Kit. Do not use a topic label or
>    a requirement id as the question; an id may follow the question as a suffix.
> 3. **Options carry the implications.** Put the substance in each option label. "One macOS account
>    per person — the OS enforces the boundary" is answerable; "Option A" is not.
> 4. **Recommend one.** State your recommended option and a one-sentence reason in the prompt text,
>    before the options.
> 5. **Respect the caps.** Five clarifications maximum per session, counted per accepted answer.
> 6. **Stop when the user signals done.** An early "done", "good", or "proceed" ends the loop; do
>    not spend the remaining budget.
> 7. **Never fall back to prose.** If the question tool is unavailable in this session, say so
>    explicitly and stop — do not silently revert to the table format.

{CORE_TEMPLATE}
