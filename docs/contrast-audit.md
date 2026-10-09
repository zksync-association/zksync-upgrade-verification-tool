# Text contrast audit — October 5, 2026

Text colors were checked against rendered backgrounds, rather than assuming everything sits on white. The app's existing light appearance and ZKsync blue/navy identity are preserved.

## Changes

Ratios below use WCAG relative luminance. Numbers are rounded for display; pass/fail checks use unrounded values. “Before” refers to the implementation at the beginning of this contrast task, including earlier uncommitted design work.

| Use | Old → new | Background | Contrast before → after |
| --- | --- | --- | --- |
| Secondary copy, facts, card descriptions, input placeholders, footer labels | `#526079` → `#3D4B63` | White `#FFFFFF` | 6.35 → **8.80** |
| Same secondary copy on the page | `#526079` → `#3D4B63` | `#F7F9FC` | 6.02 → **8.35** |
| Same secondary copy on muted surfaces | `#526079` → `#3D4B63` | `#EFF2F7` | 5.66 → **7.85** |
| Navigation and explanatory copy | `#555A66` → `#344054` | White | 6.91 → **10.46** |
| Calldata argument types, timeline numbers, textarea placeholders, faint icons | `#A1A7B3` → `#3D4B63` | White | 2.42 → **8.80** |
| Disabled input values and previously pale icons | `#858C99` → `#3D4B63` | `#F7F9FC` | 3.21 → **8.35** |
| Error text | `#B91C1C` → `#991B1B` | `#F7F9FC` | 6.13 → **7.88** |
| Success text | `#15803D` → `#14532D` | `#F7F9FC` | 4.76 → **8.64** |
| Stronger success text | `#166534` → `#14532D` | Green `#F0FDF4` | 6.81 → **8.70** |
| Warning text in veto details | `#B45309` → `#78350F` | `#F7F9FC` | 4.76 → **8.60** |
| Primary button hover background, with white text | `#3A4AE9` → `#0914C4` | Button fill | 6.29 → **11.00** |
| Destructive button background, with white text | `#DC2626` → `#991B1B` | Button fill | 4.83 → **8.31** |
| Secondary button text | `#0C18EC` → `#0914C4` | Blue-tinted page surface, normal state `#EBEEFB` | 7.69 → **9.50** |
| Secondary button text, hovered | `#0C18EC` → `#0914C4` | Hover surface `#E0E3FA` | 6.99 → **8.63** |
| Disabled/loading button labels | Entire control at 50% opacity → opaque `#3D4B63` on `#E8ECF2` | Example old primary button over white: white text on composited `#868CF6` | 2.96 → **7.43** |
| Disabled labels | `#11141A` at 70% opacity → fully opaque | White | 6.83 → **18.44** |
| Semantic muted foreground | `hsl(220 14% 34%)` (`#4B5363`) → `#3D4B63` | White | 7.73 → **8.80** |
| Semantic secondary foreground | `hsl(237 90% 49%)` → `hsl(237 91% 40%)` | `#E8EBFD` | Approximately 7.48 → **9.40** |
| Wallet dialog primary text | `#25292E` → shared foreground (approximately `#101319`) | White | 14.63 → **18.60** |
| Wallet dialog dim text | `rgba(60,66,66,0.3)` → shared muted foreground `#3D4B63` | White | 1.72 → **8.80** |
| Wallet dialog secondary text | `rgba(60,66,66,0.6)` → shared muted foreground `#3D4B63` | White | 3.31 → **8.80** |
| Wallet dialog close control | `rgba(60,66,66,0.8)` → shared muted foreground `#3D4B63` | White | Approximately 5.63 → **8.80** |
| Wallet error color | `#FF494A` → shared destructive color `#991B1B` | White | 3.33 → **8.31** |
| Selected text | Inherited foreground on a translucent blue selection → `#0A1A66` on opaque `#D5D9FB` | Selection surface | Previously depended on the selected element → **11.20** |

The default primary button remains white on `#0C18EC` (**8.91:1**); its active state is now white on navy `#0A1A66` (**15.53:1**). Body text remains `#11141A` on the page (**17.48:1**). Existing white-on-navy navigation, light text in the navy proposal lookup, full hashes/addresses, and status badges already pass; their backgrounds and text were checked too.

Disabled and loading states remain visibly distinct through an opaque muted background, cursor, spinner, and disabled behavior. They no longer fade the label. Placeholder opacity is explicitly 1, including textarea placeholders. Decorative shadows and background tints retain alpha; text does not. Wallet and toast colors now use the shared semantic tokens.

The background token was aligned with the already-visible `#F7F9FC` page background, and the document now uses that token rather than overriding it with a palette utility.

### Follow-up: button visibility

Button surfaces were subsequently strengthened because readable text alone did not make the controls easy to identify. These changes supersede the secondary and disabled button styling in the first-pass table above:

- Secondary buttons now use opaque navy `#0A1A66` with white labels (**15.53:1**), instead of faint blue-tinted surfaces. Hover uses `#0914C4` with white (**11.00:1**).
- Outline and formerly ghost buttons now have a visible 2px `#3D4B63` border (**8.80:1** against white). Ghost buttons have a solid `#EFF2F7` fill and navy text.
- Disabled/loading buttons now use `#DADDE5` with `#344054` labels (**7.70:1**) and an opaque dark border. They retain their disabled behavior.
- The primary button inside the navy proposal lookup has a white border (**15.53:1** against the surrounding navy), so its shape remains clear on the dark surface.
- Button labels use semibold weight, and link-style buttons are always underlined.

Verified the home, settings, emergency-builder, and freeze pages at desktop/mobile sizes and both browser appearance preferences, including hover, focus, disabled controls, and the freeze dialog. Type checks, formatting, and whitespace checks pass.

## Theme and imagery

There is no dark theme or theme switch in the current app. The light theme is explicitly declared with `color-scheme: light`, so native controls remain compatible when the operating system prefers dark appearance. Both browser appearance preferences were tested at both viewport sizes.

The app has no text over photographs, background images, or gradients. Its images are the logo and wallet avatars; no overlay is needed. The proposal lookup uses a solid navy background with light text and white input surfaces.

## Verification

- WebKit: 15 page routes at 1440 × 1000 and 390 × 844, with light and dark browser appearance preferences.
- 80 page/state checks, 5,488 rendered text samples, **zero AA contrast failures**. Includes placeholders, expanded verification hashes/raw calldata, the freeze dialog, wallet dialog, button hover/focus, disabled controls, error pages, and navigation/footer text.
- A final focused pass checked the darker secondary-button hover at **8.63:1** and confirmed the proposal/freeze pages render without the Safari hydration errors found during the first pass.
- Desktop/mobile screenshots inspected together. No text-over-image or gradient cases were found.
- All 78 web tests, TypeScript checks, production build, formatting, and whitespace checks pass.

The browser run found Safari's `Intl.DateTimeFormat` inserts “at” where Node inserts a comma. UTC labels now assemble the same date fields and punctuation in both environments; two regression tests cover timestamps and midnight/timezone behavior. No signing, transaction sending, or Safe service writes were performed.

Repeat the read-only audit while the app runs:

```sh
node scripts/audit-contrast.mjs
```

It uses Playwright/WebKit from the existing e2e package. Raw reports and screenshots are written under `.cache/local/`; the script stops if governance status reports warnings, trust-anchor overrides, or incomplete log history. It flags image/gradient backgrounds for manual review rather than fabricating a contrast ratio. This is a text-contrast audit, not a certification of every WCAG criterion or every possible external wallet state.

References: [WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [WCAG enhanced contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html).
