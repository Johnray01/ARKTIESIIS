---
name: ARKTIESIIS
description: An academic index for school records and administrative work.
colors:
  ink: "#1b272d"
  ink-soft: "#394850"
  muted: "#53616a"
  line: "#d9ddd9"
  line-strong: "#bac2c3"
  page: "#f4f3ef"
  surface: "#ffffff"
  surface-low: "#eeefeb"
  accent: "#922b37"
  accent-hover: "#711f29"
  accent-wash: "#f8ecee"
  focus-ring: "#922b37"
  error: "#8a202c"
  success: "#285d3d"
  success-wash: "#edf5ef"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "3.35rem"
    fontWeight: 780
    lineHeight: 1.02
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "2.05rem"
    fontWeight: 760
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.16rem"
    fontWeight: 730
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "0.96rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "0.86rem"
    fontWeight: 680
    lineHeight: 1.4
rounded:
  control: "0.42rem"
  panel: "0.6rem"
  feature: "0.9rem"
spacing:
  field-gap: "0.38rem"
  control-gap: "0.8rem"
  section-gap: "1.2rem"
  layout-gap: "clamp(2.5rem, 5vw, 5rem)"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0.58rem 0.95rem"
    height: "2.8rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.58rem 0.95rem"
    height: "2.8rem"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.62rem 0.75rem"
    height: "2.8rem"
  auth-form:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.feature}"
    padding: "clamp(1.4rem, 3.3vw, 2rem)"
  workspace-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.feature}"
    padding: "clamp(1rem, 2.2vw, 1.4rem)"
---

# Design System: ARKTIESIIS

## Overview

**Creative North Star: “The Academic Index”**

ARKTIESIIS is an institutional records workspace with an editorial frame: a persistent ink navigation rail, a clearly marked current location, and quiet, legible work surfaces. The public home and sign-in views pair their institutional context with the unchanged campus photograph; authenticated work opens into a spacious canvas beside the rail, where records, forms, and review histories take priority.

The system uses contrast and scale to establish hierarchy instead of decoration. Crimson marks the primary action, focus, and error; warm paper and cool neutral surfaces keep dense operational content calm. Its wording describes current product behavior accurately, including the advisory role and limits of OCR.

**Key Characteristics:**
- A persistent deep ink rail carries the school seal, institution and branch wording, role, sign-out action, and current-location state.
- Public and authentication views use a dark context panel beside the authentic campus photograph or focused form.
- Forms and data tables remain quiet, compact, and readable in a spacious warm-neutral workspace.
- Typography, rules, and restrained crimson provide hierarchy without decorative shadows or animation.

## Colors

The palette centers on deep blue-leaning ink, paper neutrals, and one school crimson accent, with green reserved for positive status.

### Primary
- **School Crimson:** Primary actions, links, focus indicators, and error emphasis.
- **Deep Crimson:** Hover state for links and primary actions.

### Neutral
- **Institutional Ink:** Masthead, navigation, hero panels, and primary text.
- **Soft Ink:** Paragraphs and supporting content.
- **Muted Slate:** Captions, metadata, and secondary labels; preserve sufficient contrast on page and panel surfaces.
- **Warm Paper:** Main page background.
- **White Surface:** Forms and content panels.
- **Low Surface:** Table headings and quiet secondary groupings.
- **Cool Rule:** Subtle panel and row boundaries.
- **Strong Rule:** Form control outlines and structural dividers.
- **Crimson Wash:** Inline error background.
- **Error Crimson:** Error text and state.
- **Record Green:** Positive status text.
- **Green Wash:** Positive status background.

### Named Rules
**The Ink Frame Rule.** Use the dark institutional frame to orient visitors and workspace users; let the working content stay on light, readable surfaces.

**The One Crimson Signal Rule.** Keep crimson to actions, current-location emphasis, focus, and errors. Do not turn it into a second large page background.

## Typography

**Display Font:** UI system sans-serif stack.
**Body Font:** The same UI system sans-serif stack.
**Label/Mono Font:** Labels use the system sans-serif; verification codes and amounts use tabular figures where defined.

**Character:** The type system is direct and compact, with bold headings and open body leading. Tight heading tracking distinguishes page context; field labels remain plain and easy to scan.

### Hierarchy
- **Display** (780, 3.35rem, 1.02): Main public-home heading; scales down on narrow screens.
- **Headline** (760, 2.05rem, 1.12): General page heading; authentication and workspace variants adjust size to fit their role.
- **Title** (730, 1.16rem, 1.25): Panel and section headings.
- **Body** (400, 0.96rem, 1.55): Explanatory text and dense interface copy.
- **Label** (680, 0.86rem, 1.4): Form labels and control descriptors.

### Named Rules
**The Context-Then-Task Rule.** Give each page one clear title and let its existing form, table, or review action carry the next level of attention.

## Layout

The public masthead, footer, and page content align to a maximum 82rem measure. On desktop, the public home pairs a dark institutional introduction with the unchanged campus photograph; authentication places task context beside a focused form. Authenticated pages use a persistent 16.25rem vertical ink rail next to a flexible main canvas. The rail keeps role-filtered destinations, the school identity, role, and sign-out action together; the current destination has a light surface and crimson edge.

Workspace pages use a responsive column rhythm: summary measures group in a dark strip, content sections follow below, and forms or tables keep their own clear bounds. The student-records page places page context and actions first, then a current-term strip, a filter and master-list surface, and academic-term and section tools. Database administration keeps account search and its list primary beside recent audit activity; the registrar dashboard uses a row-based index for its existing workspaces; the student dashboard groups profile information beside enrollment history and grades; and finance pairs its real summary with student search, then places account context before transaction entry and history. At 900px and below, the rail becomes a compact identity header; role and sign-out sit beside the brand when space permits and move to their own row at 400px and below. Role destinations use a single-line, horizontally scrollable navigation row with a visible current-location state. At 760px and below, dashboard and profile grids collapse to one column, and ordinary record tables become labeled rows; transaction history retains a scrollable table because column alignment is useful there. Compact identity spacing adapts at 400px and below; the document remains usable at 320px.

The spacing rhythm moves from a 0.38rem label-to-control gap through 0.8rem control groups and 1.2rem sections to a fluid feature-layout gap. Main shell gutters narrow from 3rem on wider screens to 1rem below 760px and 0.625rem below 400px.

## Elevation & Depth

The interface has no decorative box shadows. Depth comes from the dark ink frame, white working panels, low neutral groupings, and thin boundaries. Focus uses a visible outline and remains independent of elevation.

### Named Rules
**The Surface-by-Task Rule.** Reserve the dark ink field for institutional context and summaries; keep active data entry, reading, and decision tasks on light surfaces.

## Shapes

Controls use a modest 0.42rem radius; small panels and tables use 0.6rem; prominent context and content panels use 0.9rem. Thin neutral borders define forms and table boundaries. The campus photograph keeps the same prominent panel radius and its source image is not altered by this system.

## Components

### Buttons
- **Shape:** Compact, softly rounded controls with a 2.8rem minimum height.
- **Primary:** School Crimson with white text; used for the main action on a page.
- **Hover / Focus:** Primary actions darken on hover; keyboard focus uses a visible 3px outline with offset.
- **Secondary:** White with a strong neutral border and ink text. In the dark sign-out area it becomes a transparent, light-outlined control.

### Cards / Containers
- **Corner Style:** Feature panels use the larger radius; ordinary groupings use the panel radius.
- **Background:** White for forms and workspace panels; warm low-neutral surfaces for table headings and quieter groups.
- **Shadow Strategy:** No shadows; use color zones and neutral rules.
- **Border:** Thin cool-neutral line except for focused controls and the dark institutional frame.
- **Internal Padding:** Responsive panels use approximately 1rem to 1.4rem; authentication forms gain space on wider viewports.

### Inputs / Fields
- **Style:** White fill, strong neutral outline, compact rounded corners, and at least 2.8rem height.
- **Focus:** Crimson border plus a 3px translucent crimson outline.
- **Error / Disabled:** Errors use a pale crimson field with dark crimson text; disabled controls visibly reduce emphasis.

### Navigation
- **Style:** On authenticated desktop pages, the school seal and institution name sit at the top of a persistent ink rail. Existing role navigation shares that frame; the current link gets a contrasting surface and crimson edge. Sign-out is a separate outlined POST form carrying its existing CSRF token.
- **Mobile:** The rail becomes a compact identity header; role and sign-out stay clear of the brand, and role destinations sit in a single horizontal navigation row. The row scrolls horizontally when needed and keeps the active destination marked. The full page remains usable at 320px.

### Data Tables
- **Style:** Small but readable row typography, neutral column headings, subtle alternating row backgrounds, and a restrained hover state.
- **Mobile:** Regular data rows expose their existing data labels as stacked key/value pairs. Finance transaction history remains in a labeled horizontal-scroll region.

### Disclosure
- **Style:** Existing native disclosure controls reveal progressive grade or extracted-text details. The summary stays visibly actionable; the content remains ordinary text and forms.

## Do's and Don'ts

### Do:
- **Do** preserve the official seal and supplied campus photograph as provided.
- **Do** preserve existing role destinations, current-location semantics, route actions, field names, CSRF fields, EJS escaping, and server authorization.
- **Do** keep forms and operational tables on light surfaces within the ink institutional frame.
- **Do** keep existing OCR wording advisory; staff review remains part of document acceptance.
- **Do** maintain visible keyboard focus and layouts usable at 320px.

### Don't:
- **Don't** invent role navigation, counts, operational capabilities, or document-verification claims.
- **Don't** add decorative gradients, shadows, external fonts, or replacement campus imagery.
- **Don't** use the ink field as the background for dense forms or long data tables.
- **Don't** shrink labels below comfortable reading size to force narrow layouts; reflow the content instead.
