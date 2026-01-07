# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime & Package Management

This project uses **Bun** as the JavaScript runtime and package manager.

- Install dependencies: `bun install`
- Add packages: `bun add <package>`
- Add dev dependencies: `bun add -D <package>`
- Run scripts: `bun run <script>`

## Data Analysis & Manipulation

For data analysis and manipulation tasks:

- **Primary choice**: Use **DuckDB** for SQL-based data operations
- **Secondary choice**: Use **Polars** for high-performance data manipulation
- **Never use**: Pandas

This ensures consistent, performant data handling across the codebase.
