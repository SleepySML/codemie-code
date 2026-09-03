#!/usr/bin/env node

/**
 * CodeMie Native (Built-in) Agent Entry Point
 * Entry point for codemie-code command (built-in agent)
 *
 * NOTE: Other agents (claude, gemini) have their own entry points
 * to avoid Windows npm wrapper detection issues.
 */

import { AgentCLI } from '../dist/agents/core/AgentCLI.js';
import { AgentRegistry } from '../dist/agents/registry.js';
import { installProcessGuards } from '../dist/utils/process-guards.js';

// Last-line-of-defence net for async rejections that escape a command action.
// Installed per entrypoint rather than in the AgentCLI constructor, so merely
// constructing an AgentCLI (as unit tests do) never mutates global process state.
installProcessGuards();


// Load built-in agent (codemie-code)
const agent = AgentRegistry.getAgent('codemie-code');

if (!agent) {
  console.error('✗ CodeMie Native agent not found in registry');
  process.exit(1);
}

// Create and run CLI
const cli = new AgentCLI(agent);
await cli.run(process.argv);
