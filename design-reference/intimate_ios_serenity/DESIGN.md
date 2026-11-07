---
name: Intimate iOS Serenity
colors:
  surface: '#fcf8fb'
  surface-dim: '#dcd9dc'
  surface-bright: '#fcf8fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f5'
  surface-container: '#f0edef'
  surface-container-high: '#eae7ea'
  surface-container-highest: '#e4e2e4'
  on-surface: '#1b1b1d'
  on-surface-variant: '#59413e'
  inverse-surface: '#303032'
  inverse-on-surface: '#f3f0f2'
  outline: '#8c716d'
  outline-variant: '#e0bfbb'
  surface-tint: '#ae3029'
  primary: '#ae3029'
  on-primary: '#ffffff'
  primary-container: '#ff6b5e'
  on-primary-container: '#6d0005'
  inverse-primary: '#ffb4ab'
  secondary: '#5d5e63'
  on-secondary: '#ffffff'
  secondary-container: '#e0dfe4'
  on-secondary-container: '#626267'
  tertiary: '#006b54'
  on-tertiary: '#ffffff'
  tertiary-container: '#00af8a'
  on-tertiary-container: '#003a2c'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdad6'
  primary-fixed-dim: '#ffb4ab'
  on-primary-fixed: '#410002'
  on-primary-fixed-variant: '#8c1715'
  secondary-fixed: '#e3e2e7'
  secondary-fixed-dim: '#c6c6cb'
  on-secondary-fixed: '#1a1b1f'
  on-secondary-fixed-variant: '#46464b'
  tertiary-fixed: '#74f9d0'
  tertiary-fixed-dim: '#54ddb5'
  on-tertiary-fixed: '#002117'
  on-tertiary-fixed-variant: '#00513e'
  background: '#fcf8fb'
  on-background: '#1b1b1d'
  surface-variant: '#e4e2e4'
typography:
  display:
    fontFamily: Inter
    fontSize: 34px
    fontWeight: '700'
    lineHeight: 41px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.003em
  body-bold:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.003em
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.0em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
    letterSpacing: -0.015em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.25rem
  space-xl: 1.75rem
---

## Brand & Style

This design system delivers an intimate, human, and refined digital space crafted specifically for two people. Embracing the clarity, restraint, and tactile precision of modern iOS Human Interface Guidelines, it provides a sanctuary free of clutter, aggressive notifications, and unnecessary visual noise. 

The emotional signature is warm, secure, and effortlessly lightweight. Interactions evoke the quiet luxury of high-end editorial paper products paired with fluid, native mobile responsiveness. The aesthetic sits firmly at the intersection of **Apple-inspired minimalism** and **soft ambient realism**: generous whitespace, luminous off-white surfaces, subtle frosted glass treatments for navigation elements, and a delicate, joyful coral accent that draws focus only to meaningful relationship milestones and shared interactions.

## Colors

The palette balances strict discipline with warm emotional resonance:

- **Primary Accent (`#FF6B5E`)**: A warm, radiant coral. Reserved strictly for intentional, high-value touchpoints: primary action buttons, active tab indicators, milestone celebratory badges, and shared reaction pulses. Never overused on backgrounds or decorative fills.
- **Canvas Base (`#F5F5F7`)**: The authentic iOS light system canvas, providing warm contrast against elevated white elements.
- **Surface Elevation (`#FFFFFF`)**: Pure crisp white applied to primary cards, modal bottom sheets, and interactive containers.
- **Translucent Frosted Overlay (`rgba(255, 255, 255, 0.78)`)**: Used across top bars and fixed bottom navigation with `backdrop-filter: blur(20px) saturate(180%)` to allow underlying content color to gently bleed through during scroll.
- **Typography & Content**:
  - Primary Label (`#1C1C1E`): Deep charcoal for optimal legibility and contrast on white and neutral backgrounds.
  - Secondary Label (`#8E8E93`): Muted system slate for timestamps, supporting captions, and secondary metadata.
  - Tertiary Label (`#AEAEB2`): Pale neutral for inactive glyphs, empty states, and divider accents.
- **Subtle Separators (`rgba(60, 60, 67, 0.08)`)**: Hairline dividers replicating iOS retina 0.5px border specs.

## Typography

The type hierarchy uses **Inter** with precise optical tracking and negative letter-spacing calibrated to mirror Apple's native San Francisco (SF Pro) typography. 

Special considerations for Russian Cyrillic typesetting:
- Cyrillic ascenders and capital heights require consistent vertical rhythm: line-heights are locked to clean 2px and 4px proportional multiples.
- Micro-copy and captions (`label-md`, `label-sm`) avoid condensed weights to preserve Cyrillic glyph clarity on compact mobile screens.
- Headers employ soft tight kerning (`-0.01em` to `-0.02em`) for an editorial, grounded balance.
- Title cases in Russian remain naturally formatted (sentence casing) rather than full uppercase capitalization to maintain an intimate, conversational tone.

## Layout & Spacing

Designed primarily for Telegram Mini App viewport constraints on mobile devices (iOS & Android) with clean adaptive scaling for Telegram Desktop:

- **Container Model**: Fluid single-column mobile container locked to a maximum centered width of 480px on desktop environments, framed by `#F5F5F7` backdrop boundaries.
- **Horizontal Insets**: Standard 16px (`1rem`) outer margins ensure comfortable thumb touch zones away from bezel curves.
- **Vertical Flow**: A modular 4px base rhythm dictates consistent spacing. Large section divides use 28px (`space-xl`), standard component stacking utilizes 16px (`space-md`), and micro-groupings (such as avatar-to-name tags) align at 8px (`space-sm`).
- **Safe Area Insets**: Top safe zone respects Telegram's native navigation header bar; bottom safe zone reserves a minimum of 34px padding below fixed navigation tabs to accommodate iOS home indicator gestures.

## Elevation & Depth

Visual hierarchy relies on precise planar layering rather than heavy, dramatic shadows:

- **Level 0 (Canvas)**: Background surface `#F5F5F7`.
- **Level 1 (Cards & Modules)**: Pure white `#FFFFFF` cards with an ultra-soft, diffused shadow:
  - `box-shadow: 0px 4px 20px rgba(0, 0, 0, 0.04), 0px 1px 3px rgba(0, 0, 0, 0.02);`
  - Subtle hairline borders: `1px solid rgba(0, 0, 0, 0.03)` to maintain edge crispness under varied screen brightness.
- **Level 2 (Floating Sheets & Popovers)**: Elevated modals and context action menus:
  - `box-shadow: 0px 12px 36px rgba(0, 0, 0, 0.08), 0px 4px 12px rgba(0, 0, 0, 0.04);`
- **Level 3 (Frosted Navigation & Sticky Elements)**: Semi-transparent glass:
  - `background: rgba(255, 255, 255, 0.82);`
  - `backdrop-filter: blur(20px) saturate(180%);`
  - Bottom boundary (or top boundary for footer): `0.5px solid rgba(0, 0, 0, 0.08)`.

## Shapes

The visual language is characterized by organic, friendly corner radii inspired by continuous iOS "squircle" curvature (`corner-smoothing: 60%` where CSS Houdini/SVG masking is available):

- **Primary Cards**: Strictly 20px border radius, creating a soft, welcoming feel for memory tiles, task lists, and shared calendars.
- **Buttons & Action Controls**: Fully rounded pill shapes (`9999px`) or matching 14px continuous curves depending on touch targets.
- **Partner Avatars**: Perfect circular shapes (50%) with dual-ring status borders (white inner gap + coral accent for active presence).
- **Badges & Chips**: 10px to 12px radius, keeping them distinct from primary interactive buttons.

## Components

### Buttons
- **Primary Action**: Pill-shaped or 16px rounded button, background `#FF6B5E`, text `#FFFFFF`, font weight 600. Active state uses micro-scale feedback (`transform: scale(0.97)` and 10% black overlay).
- **Secondary Action**: Background `rgba(255, 107, 94, 0.12)`, text `#FF6B5E`, hover/pressed state `rgba(255, 107, 94, 0.18)`.
- **Ghost/Tertiary Action**: Transparent background, text `#8E8E93`, hover `#1C1C1E`.

### Cards & Modules
- Single continuous white container (`#FFFFFF`), border radius 20px, internal padding 16px or 20px.
- Internal list dividers use an inset of 16px from the left, styled as `0.5px solid rgba(60, 60, 67, 0.08)`.

### Chips & Badges
- **Status Badges**: Semi-transparent warm backgrounds (e.g., `rgba(255, 107, 94, 0.10)`), `#FF6B5E` text, 6px 10px padding, typography `label-sm`.
- **Selection Chips**: White pill with subtle border `1px solid rgba(0, 0, 0, 0.08)`. When selected: filled with `#1C1C1E` and white text, or `#FF6B5E` when representing joint decisions.

### Lists & List Rows
- Native iOS cell pattern: 48px to 56px row height, left icon or partner indicator, title in `#1C1C1E`, accessory trailing value in `#8E8E93` accompanied by a chevron (`#C7C7CC`).

### Inputs & Controls
- **Text Inputs**: Flat container with background `#FFFFFF` or `#EBEBF0`, border radius 12px, padding 12px 16px. Placeholder text `#8E8E93`. Focus state introduces a subtle `#FF6B5E` outer ring glow (`0 0 0 3px rgba(255, 107, 94, 0.2)`).
- **Toggle Switches**: iOS-styled switches. Track inactive: `#E9E9EB`; track active: `#FF6B5E`; thumb: pure white `#FFFFFF` with drop shadow `0 3px 8px rgba(0, 0, 0, 0.15)`.

### Couple-Specific Custom Components
- **Dual Avatar Status Ring**: Overlapping circular avatars (Алексей & Маша) bound by a shared 2px white stroke, with a central coral heart pulse badge linking their profiles.
- **Shared Countdown Tile**: Pure white card featuring a large typography milestone counter, warm coral header, and soft progress fill bar.
- **Emotion Quick-Reaction Bar**: Frosted glass floating horizontal strip featuring micro-haptic reactions and quick status prompts.