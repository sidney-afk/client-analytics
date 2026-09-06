# Recovery callable lexer correction

Preserved base: `fa4e175742e7fe7c903f694d9b341767d4929ed2` (PR1313). This is a bounded source correction to dependency classification. No database, provider, HTTP, workflow, corpus definition, writer, authentication or live setting was changed.

The old `stripBlockComments` scanned comment delimiters before recognizing SQL strings. A fictional function assigning `'/*'`, then executing `PERFORM public.synthetic_write()`, then assigning `'*/'` was classified pure with no calls. The same unhidden `PERFORM` was correctly refused. Separately, `public."synthetic_write"()` became `q`, and the reader accepted an unrelated `q: not_a_function` declaration. The latter is a reader-classification probe, not a proved full capture bypass: catalog dependency edges can detect direct calls.

One lexical pass now recognizes ordinary/E-prefixed strings, dollar strings, quoted identifiers, line comments and nested block comments. It is shared by block-comment removal, outer dollar-body extraction, writing-keyword checks and callable extraction. Delimiters inside strings cannot consume later executable code. Quoted lowercase identifiers retain their exact callable identity, including names otherwise treated as keywords. Real `lower`/`upper` calls are scanned. Literal writing words and quoted variable names do not create writing-statement refusals.

The current manifest/target contract supports lowercase ASCII callable names with at most schema qualification. Mixed-case, escaped, Unicode-escaped or otherwise unrepresentable callable identifiers now refuse explicitly instead of being silently folded or replaced. Unterminated tokens and ordinary non-E strings whose quote interpretation depends on an odd preceding backslash also refuse. E-prefixed escapes remain supported. This is not a complete SQL grammar, operator/cast dependency proof or claim that every executable language feature is safe.

Actual capture already injected private `prosrc` into its resolution query. The patch expresses that same projection directly, removes the string replacement, and refuses missing/non-string public function bodies. It does **not** claim that the previous actual capture lacked those bodies. Classification still returns body hashes rather than body text.

## Evidence

**33 new offline actual-export groups and 18 preserved package groups pass.** The new groups include the original baseline failure and unhidden control, quoted callable/read-contract negatives, known quoted pure-function positive, nested comments, escaped strings, dollar tags, malformed input, false-refusal controls, and private-body boundary checks. The actual base module and candidate module were loaded for the comparison; no cloned classifier and no database execution were used.

[Sanitized comparison](2026-09-06-recovery-callable-lexer-evidence.json) records exact source hashes and outcomes. Baseline source SHA-256: `90768f446046a6e7809eda0c5bff188c9b00291700db0ccf91987f1444d5fbdd`. Candidate source SHA-256: `b86ecbfc52cc47e3e2981c170674963cd88c4e595ab66cd9b34f882ae456aff8`.

Commands: `node test/track-b-recovery-callable-lexer.js`; `node test/track-b-recovery-package.js`. These are finite offline results, not schema reconstruction, deployment or release readiness. Canonical corpus integration and labels remain separate holds. Rollback must retain the patched reader/classifier or hold recovery; restoring the known lexer bypass is not a safe release inverse.
