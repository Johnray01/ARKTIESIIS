---
name: ARKTIESIIS
description: A restrained school information interface for the Lucena Branch.
colors:
  primary: "#922b37"
  primary-hover: "#761e29"
  page: "#f3f5f7"
  surface: "#ffffff"
  ink: "#1b232c"
  ink-soft: "#3d4853"
  muted: "#52606d"
  line: "#d8dee4"
  line-strong: "#aeb8c2"
  error: "#8a202c"
  accent-wash: "#f8ecee"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "3.2rem"
    fontWeight: 720
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "2.75rem"
    fontWeight: 720
    lineHeight: 1.15
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.15
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "0.92rem"
    fontWeight: 650
    lineHeight: 1.4
rounded:
  control: "0.35rem"
  panel: "0.7rem"
spacing:
  field-gap: "0.45rem"
  control-gap: "0.9rem"
  section-gap: "1.5rem"
  layout-gap: "2.2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0.65rem 1.05rem"
    height: "2.9rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.65rem 1.05rem"
    height: "2.9rem"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.7rem 0.8rem"
    height: "3rem"
  auth-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "2.25rem"
  brand-masthead:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    height: "4.25rem"
---

# Design System: ARKTIESIIS

## Overview

**Creative North Star: “The Records Desk”**

The interface is a clear, restrained school-office workspace. The official seal and the Lucena Branch building photograph place the pages in their real institutional setting; consistent type and form controls keep sign-in and verification easy to scan.

Surfaces stay cool and neutral, with crimson used for the action and focus moments that need attention. The interface states only what is present: role dashboards remain placeholders until their tools exist.

**Key Characteristics:**
- The school seal and building image are authentic identity assets, not decoration.
- Red is reserved for primary actions, small links, and keyboard focus.
- System sans-serif typography, flat surfaces, and readable form spacing carry across every page.
- Role dashboards describe their current placeholder state without invented counts or navigation.

## Colors

The palette pairs a deep school crimson with cool gray-white surfaces and dark, high-contrast text.

### Primary
- **School Crimson**: Primary sign-in and verification actions, links, and visible keyboard focus.
- **Deep Crimson**: Hover state for primary actions.

### Neutral
- **Cool Mist**: Main page background.
- **White Surface**: Header, footer, and authentication form surface.
- **Ink**: Headings and primary text.
- **Soft Ink**: Body copy.
- **Muted Slate**: Supporting copy and captions.
- **Cool Line**: Subtle field, header, footer, and section separators.
- **Strong Line**: Form-control outlines and structural dividers.
- **Error Crimson**: Authentication errors.
- **Crimson Wash**: Background for inline error messages.

**The One Crimson Rule.** Keep large areas neutral; use crimson where a person acts, focuses, or needs to notice an error.

## Typography

**Display Font:** UI system sans-serif stack.
**Body Font:** The same UI system sans-serif stack.
**Label/Mono Font:** Labels use the same sans-serif stack; verification digits use tabular numerals.

**Character:** Direct, familiar, and compact enough for an administrative interface. Strong weight and restrained negative tracking distinguish page headings without introducing an external font dependency.

### Hierarchy
- **Display** (bold, compact line-height): Homepage heading.
- **Headline** (bold, compact line-height): Sign-in, verification, error, and dashboard headings.
- **Title** (strong, compact line-height): Form and placeholder section headings.
- **Body** (regular, open line-height): Main copy; explanatory text stays at a readable measure.
- **Label** (semibold): Form field labels.

## Layout

The header, footer, and page content share a maximum width of 72rem. On wide screens, the homepage pairs its introduction and sign-in action with a prominent building image; authentication pages pair task context with the form. At 760px and below, each layout stacks into one column. The homepage image uses a 3:2 crop on desktop and a 4:3 crop on narrow screens. At 400px and below, the seal and brand type reduce while keeping the full school name readable. The 320px minimum layout has been checked for horizontal overflow.

Authenticated workspaces use compact top spacing so their page heading and primary task remain visible near the navigation. Record tables wrap related actions together and present student and enrollment states in readable labels. On existing student profiles, registrars see the student number as read-only; new profiles still accept a number, and database administrators can correct one. On a finance account page, the account is the primary content and the back link returns to the prior filtered workspace. Academic grade history stays visible while its edit and add forms are grouped in a native disclosure; validation errors reopen that disclosure.

Home, sign-in, and workspace heading blocks align to a thin neutral folio spine. On the wide homepage, the school-account copy and sign-in action share a row; they stack on narrow screens.

## Elevation & Depth

The interface is flat. Neutral borders separate panels and controls; there are no decorative shadows. Focus is shown with a clear outline rather than elevation.

## Motion

The homepage building photograph uses one short top-to-bottom reveal on entry. The image stays visible when scripts do not run, and reduced-motion preferences skip the reveal.

## Shapes

Controls use gently rounded corners; the authentication surface and image use a slightly broader radius. Borders stay thin and neutral, except inline errors, which use a matching crimson outline.

## Components

### Buttons
- **Shape:** Compact, gently rounded corners with a comfortable touch-sized minimum height.
- **Primary:** School Crimson with white text; used for the main sign-in and verification action.
- **Hover / Focus:** Primary actions darken on hover; all interactive controls use a 3px visible focus outline.
- **Secondary:** White surface with a neutral border and ink text for resend and sign-out actions.

### Cards / Containers
- **Corner Style:** Authentication form surface and homepage image use a softly rounded radius.
- **Background:** Authentication form uses White Surface; the placeholder state stays on the page ground.
- **Shadow Strategy:** Flat; use a border rather than a shadow to define the form surface.
- **Border:** Thin Cool Line.
- **Internal Padding:** Authentication form uses responsive padding that increases on wide screens.

### Inputs / Fields
- **Style:** White background, Strong Line outline, gently rounded corners, and comfortable field height.
- **Focus:** Crimson border plus a visible outline.
- **Error / Disabled:** Errors use an inline alert with a pale crimson wash and dark crimson text; disabled buttons are visibly subdued.

### Navigation
- **Style:** The masthead keeps the unmodified school seal, ARKTIESIIS name, full institution name, and branch. Public pages link the brand to home; authenticated pages link it to the role dashboard. A compact shared navigation row exposes only existing destinations for the signed-in role, marks the current destination, and keeps CSRF-protected sign-out separate from page links.
- **Flow:** Detail forms use fixed parent links to their existing workspace pages. Authentication and error pages offer a direct recovery destination without relying on browser history or referrer values.

### Homepage Image
- **Style:** The edited school-building photograph is presented as a wide, responsive image with a descriptive caption and alt text. The source image and school mark are recorded separately in `public/images/README.md`.

## Do's and Don'ts

### Do:
- **Do** use the official seal without changing its image contents.
- **Do** keep the red accent for actions, links, focus, and error states.
- **Do** use the supplied building photograph as the homepage's main visual.
- **Do** preserve CSRF fields, route names, field names, and escaped EJS content when updating these forms.
- **Do** label future dashboard work as unavailable in this build until it exists.

### Don't:
- **Don't** invent dashboard tools, counts, or role navigation.
- **Don't** replace the institutional images with generic school or campus imagery.
- **Don't** add a saturated secondary palette, gradients, or decorative shadows.
- **Don't** expose raw authentication, database, or SMTP error details in page copy.
