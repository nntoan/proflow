> **This wrapper supersedes the clarification step in the command below.**
>
> Where this command would present a clarification as a Markdown table and then "wait for user
> response", ask it with the question tool instead — the interactive multiple-choice prompt this
> harness exposes. The table format described below is **replaced** by that tool call; the rest of
> the command's instructions (what to extract, what to write, where to save) still apply.
>
> Why: a decision written as prose can end the turn with the decision still open, and the user has
> to notice and re-prompt. A tool call is a real stop that cannot be silently skipped.
>
> Rules for the call:
>
> 1. **One question per call, in sequence.** Ask the highest-impact clarification, wait for the
>    answer, fold it into the spec, then ask the next. Never send your whole queue in one call —
>    each answer can change which question is worth asking next.
> 2. **Options carry the implications.** Put the choice in the option label, not only in the
>    prompt: an option that reads "Route by remote URL" is answerable; one that reads "Option A" is
>    not.
> 3. **Recommend one.** Say which option you recommend and why, in the prompt text, before the
>    options. A recommendation the user can accept beats a neutral list.
> 4. **Respect the caps.** Do not exceed the number of clarifications this command allows.
> 5. **A short answer is still possible.** If no discrete options fit, ask for a short answer in
>    the prompt text rather than inventing options.
> 6. **Never fall back to prose.** If the question tool is unavailable in this session, say so
>    explicitly and stop — do not silently revert to the table format.

{CORE_TEMPLATE}
