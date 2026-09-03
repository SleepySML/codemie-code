#!/usr/bin/env node

/**
 * Claude Code Agent Entry Point
 * Direct entry point for codemie-claude command
 */

import { AgentCLI } from '../dist/agents/core/AgentCLI.js';
import { AgentRegistry } from '../dist/agents/registry.js';
import { installProcessGuards } from '../dist/utils/process-guards.js';

// Last-line-of-defence net for async rejections that escape a command action.
// Installed per entrypoint rather than in the AgentCLI constructor, so merely
// constructing an AgentCLI (as unit tests do) never mutates global process state.
installProcessGuards();


const agent = AgentRegistry.getAgent('claude');
if (!agent) {
  console.error('✗ Claude agent not found in registry');
  process.exit(1);
}

const cli = new AgentCLI(agent);
await cli.run(process.argv);
