# Design improvement plan

## Review findings

The current light theme and full hashes support careful verification, but the large homepage
hero pushes the working data below the first viewport. Repeating bordered cards, oversized
counts, and saturated accents gives too many elements the same importance.

More importantly, unavailable Safe data can appear as a clean zero. A completed approval can
also lead with today's signature count, making the recorded approval look incomplete. These
are presentation problems with consequences for a signer interpreting the evidence.

## Implementation

1. **Make the homepage a review workspace.** Keep a compact heading, a labelled proposal lookup,
   and a single scannable list of governance flows. Display incomplete discovery explicitly.
2. **Separate evidence from uncertainty.** Count only contract-validated signatures. When members
   are unavailable and the threshold is not confirmed, show an incomplete check and a verified
   lower bound rather than a definitive shortfall. Keep rejected contract checks explicit.
3. **Put completed evidence first.** Show the recorded transaction and historical re-check before
   the current member list. Separate unavailable Safe comparisons from actual mismatches.
4. **Improve shared ergonomics.** Keep network context visible on phones, use consistent controls
   and clear keyboard focus, give copy buttons larger touch targets, and retain full hashes.
5. **Verify and serve.** Run lint, types, and hermetic tests; inspect desktop and mobile overview
   and upgrade pages together; fix issues in one batch and confirm once. Keep the site on port 3000.

## Acceptance criteria

- A signer can reach a proposal or governance flow from the first screen without a marketing hero.
- Unknown results never imply missing signatures, failed historical approval, or a complete empty list.
- The contract's threshold result remains authoritative, including during Safe API failures.
- Historical rejection or unavailable historical checks remain explicit.
- Full hashes and addresses wrap without page overflow on narrow screens.
- Mainnet checks remain read-only, with no signing or transaction submission during verification.

## Validation

- Web lint and type checking pass; the production build succeeds.
- All 58 hermetic web tests pass, including regression coverage for incomplete lists, unavailable
  signature sources, authoritative contract results, and completed-action evidence.
- Desktop (1440 px) and mobile (390 px and 320 px) overview and upgrade pages have no horizontal
  overflow. The skip link, invalid-id feedback, and completed-member disclosures work.
- The local mainnet status reports no warnings or network overrides, and log history is `ok`.
- Safe API rate limiting remains an external limitation; the interface labels the affected lists
  as incomplete. The repository-wide lint command encounters existing errors in the untracked
  contracts checkout; web lint passes without modifying that checkout.
