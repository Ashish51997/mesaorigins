# Mass Polymer ERP — UI Style Guideline

_Updated 2026-07-24. This is the single source of truth for the look and feel.
The design tokens that implement it live in `src/index.css` (`:root`, `.dark`, and
the Tailwind `@theme` block); every screen inherits them through mapped utility
classes, so change a token here and it changes app-wide._

## Aesthetic
Clean modern SaaS. Airy, light, lots of whitespace. A radial glow sits behind the
app shell — soft electric blue at the top fading to white at the bottom. Negative
space is a feature; never crowd.

## Layout
- **Floating pill-shaped nav bar** at the top (the header pill: rounded-full, soft
  shadow, sitting on its own margin over the glow).
- Content sits on a grey-tinted section (`#F5F7FA`). Hero/preview cards float on it
  with soft shadow; a smaller stat card may overlap an edge to add depth.

## Colour
| Token | Light | Use |
|---|---|---|
| Primary | `#4438E0` | filled buttons, active nav, links |
| Ink | `#0B0B0F` | headings, metric numbers |
| Body | `#5B6472` | paragraph / label text |
| Hairline border | `#E7EAF0` | all borders — hairline only |
| Grey section | `#F5F7FA` | page/section background |
| Accent — violet | `#8B5CF6` | icon tile |
| Accent — cyan | `#38BDF8` | icon tile |
| Accent — coral | `#FB8C5A` | icon tile |
| Delta up (good) | green | trend chip |
| Delta down (bad) | red | trend chip |

Dark theme (office roles) uses the same language on a deep indigo-navy with a
lighter primary (`#6D63FF`) and the same glow.

## Type
- **Poppins SemiBold** for headings and metrics — tracking `-0.01em` (a touch of
  negative, *not* tight; Poppins needs breathing room).
- **Inter Regular** for body, in `#5B6472`.
- **Roboto Mono** for lot ids, readings, and all traceability — never truncated.

## Components
- **Metric card**: white, 20–24px radius (`rounded-2xl`), soft shadow only. Layout:
  a rounded-square **icon tile** (12px radius, single accent colour — use the
  `.tile .tile-violet|cyan|coral|primary` classes) top-left, a small muted `~13px`
  label (`.metric-label`), a large bold metric `32–40px` (`.metric-value`, Poppins),
  and a green/red trend **delta chip** (`.delta .delta-up|.delta-down`).
- **Buttons & badges**: fully rounded **pills**. Primary = filled `#4438E0`;
  secondary = outline. (Primary `bg-indigo-600`/`bg-blue-600` are auto-pilled.)
- **Segmented progress bar**: blue `#2563EB` → magenta `#E5449C` → purple `#7C3AED`,
  with percentage labels above (`.segmented-bar > .seg-blue|.seg-magenta|.seg-purple`).
- **Icon tile** helper: `.tile` (44×44, 12px radius) + a colour modifier.

## Rules
- **8px spacing grid.**
- **Hairline borders** `#E7EAF0` — never heavy.
- **Soft shadows only**, never harsh: the single token is
  `0 8px 24px rgba(16,24,40,.08)`. Every `shadow-*` utility maps to it.
- **Round everything** — radius scale is bumped (`rounded-xl`≈20, `rounded-2xl`≈24);
  pills for buttons/badges/nav.
- Keep it uncluttered.

## Status discipline (unchanged, overrides aesthetics)
Green / amber / red only, **always colour + icon + words** together (never colour
alone). Plain sentences, no jargon. This rule wins over any styling choice.

## How to apply
Prefer existing Tailwind classes — they already resolve to these tokens. For the
named components use the helper classes above (defined at the bottom of
`src/index.css`). Do not hard-code hex values in components; reference tokens.
