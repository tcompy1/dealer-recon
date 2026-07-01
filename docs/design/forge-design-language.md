# Forge Design Language

Dealer-Recon is a specialized workflow application, not a general ForgeOS knowledge workspace.

Apply the ForgeOS visual language, typography, spacing, hierarchy, color system, and component philosophy.

Do not introduce:
- tree navigation
- inspector panels
- IDE-style workspace layouts
- additional navigation structures
- document-centric interfaces
- metadata-heavy screens

The five-step workflow remains the dominant organizing principle.

## Purpose

The Forge Design Language (FDL) defines the visual, interaction, and information architecture standards for all Forge-built software.

Its purpose is to create a consistent user experience across every product built within the Forge ecosystem.

Products should feel related regardless of their business domain.

Examples:

- ForgeOS
- Dealer-Recon
- Accounting Operations Platform
- AI Development Platform
- Future Saas Products

The Forge Design Language serves as the source of truth for interface design decisions.

# Vision

Forge products should feel like modsern knowledge workstations.

Users should feel as though they are operating a professional system rather than interacting with a collection of web forms.

The user experience should prioritize:
- Information
- Context
- Navigation
- Workflow
- Traceability

Over:

- Decoration
- Excessive whitespace
- Visual trends
- Marketing aesthetics

# Primary Inspiration

## Microsoft Encart 95

Primary influence.

Desired qualities:

- Information dense
- Structured navigation
- Discoverable knowledge
- Strong hierarchy
- Clear relationships
- Persistent context

## Microsoft Bookshelf

Desired qualities:

- Reference-first design
- Searchability
- Fast navigation
- Clear categorization

## Windowws 95 Explorer

Desired qualities:

- Tree navigation
- Hierarchical organization
- Familiar worklows
- Persistent location awareness

## Visual Studio

Desired qualities:

- Workspace layout
- Dockable information panels
- Project navigation
- Tool visibility

## JetBrains IDEs

Desired qualities:

- Information-rich interfaces
- Strong productivity focus
- Efficient workflows

# Design Philosophy

## Knowledge First

Forge products are knowledge systems.

Documents, decisions, requirements, reviews, and execution history are first-class entities.

Knowledge should never feel secondary to dashboards.

## Context Matters

Every screen should answer:

Where am I?

What am I looking at?

What can I do next?

Users should never feel lost.

## Productivity Over Decoration

Visual design should improve efficiency.

Avoid design decisions that exist only for visual appeal.

## Dense But Readable

Users should be able to see meaningful information without excessive scrolling.

Density should never sacrifice readability.

## Consistency Over Novelty

Predictable interfaces are preferred over creative interfaces.

Users should learn Forge once and apply that knowledge everywhere.

# Emotional Goal

Desired reaction:

"I am operating a professional system."

Undesired reaction:

"I am filling out forms."

# Information Architecture

Every Forgre application should follow a hierarchical structure.

Example:

Project

→ Milestones

→ Work Items

→ Documents

→ Reviews

→ Execution Runs

Relationships should be visible.

Users should understand where information belongs.

# Layout System

## Primary Layout

┌───────────────────────────────────────────────┐

│ Header │

├───────────────┬───────────────────────────────┤

│ Navigation │ Main Workspace │

│ Tree │ │

│ │ │

├───────────────┴───────────────────────────────┤

│ Status / Context Area │

└───────────────────────────────────────────────┘

## Navigation Panel

Position:

Left side.

Purpose:

Provide persistent navigation.

Examples:

Projects

Milestones

Work Items

Documents

Reviews

Settings

Navigation should rarely disappear.

## Workspace Area

Primary content region.

Purpose:

Display active objects.

Examples:

Document editor

Project detail

Review dashboard

Execution results

## Inspector Panel

Optional right-side panel.

Purpose:

Display metadata and related information.

Examples:

Status

Priority

Owner

Depenedencies

Review state

History

Inspired by:

Windows Explorer

Visual Studio

JetBrains IDEs

# Navigation Model

## Tree-Based Navigation

Preferred navigation structure:

Projects

├── Milestones

├── Work Items

├── Documents

├── Reviews

└── Execution Runs

Users should understand hierarchy immediately.

## Breadcrumb Navigation

Every major screen should display breadcrumbs.

Example:

Projects

/

Dealer-Recon

/

Milestones

/

Data Import Foundation

# Typography

## Design Goals

Typography should be:

- Professional
- Dense
- Readable
- Technical

## Preferred Fonts

Primary:

Segoe UI

Alternatives:

Inter

IBM Plex Sans

System UI

## Typography Rules

Avoid oversided text.

Avoid excessive font weights.

Favor information density.

# Color System

## Design Goals

Colors should communicate meaning.

Colors should not dominate the interface.

## Primary Pallette

Muted Blue

Slate Gray

Warm White

Charcoal

Soft Borders

## Avoid

Neon colors

Heavy gradients

Glassmorphism

Excessive shadows

Bright startup aesthetics

Crypto-style dashboards.

# Component Philosophy

## Tables

Preferred over card grids when displaying operational data.

Reason:

Higher information density.

## Cards

Used only when grouping information improves clarity.

Not used as the default layout patter.


## Status Inidcators

Small.

Information-rich.

Color-supported.

Text-visible.

Never rely on color alone.

## Forms

Compact.

Efficient.

Minimal vertical waste.

## Dialogs

Focused.

Single-purpose.

Action-oriented.

# Document Experience

Documents are core Forge entities.

Documents should feel similar to:

Encart Articles

Technical Documentation

Knowledge Bases

Documents shoudl support:

- Versioning
- Relationships
- References
- Searchbality

# Workspace Model

Forge applications should feel like:

Explorer

*

IDE

*

Knowledge Base

Not:

Marketing Website

*

Dashboard

# Accessibility Standards

All Forge products should support:

- Keyboard navigation
- Screen readers
- High contrast modes
- Accessible color ratios
- Clear focus states

Accessibility is manadatory.

# Responsive Behavior

Desktop is the primary experience.

Tablet support is required.

Mobile support should prioritize:

- Reading
- Reviewing
- Monitoring

Complex creation workflows may remain desktop-focused.

# Future Design System Assets

Future deliverables:

- Color Tokens
- Typography Tokens
- Component Library
- Icon Library
- Layout Standards
- Motion Standards
- Design Review Checklist

# Definition of Success

The Forge Design Language is successfull when:

- Users can move between Forge products without relearning navigation.
- Information remains easy to discover.
- Knowledge feels central to the experience.
- Interfaces remain productive as product grows.
- Products feel professional and timeless.
- The design language remains recognizable across all Forge-built software.

The goal is not nostalgia.

The goal is to combine the information architecture strengths of Encarta 95 with modern software engineering, accessibility, and interaction design.