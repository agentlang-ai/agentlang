#!/usr/bin/env -S deno run -A

/**
 * Build script for AgentLang language server using Deno
 * 
 * This script provides a cross-platform way to build the AgentLang language server
 * with proper error handling and progress reporting.
 */

// Cross-platform command execution with Deno.Command
const exec = async (
  cmd: string,
  args: string[] = [],
  cwd?: string
): Promise<{ stdout: string; stderr: string; code: number }> => {
  const command = new Deno.Command(cmd, {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  });

  const { code, stdout, stderr } = await command.output();
  
  const decoder = new TextDecoder();
  return {
    stdout: decoder.decode(stdout).trim(),
    stderr: decoder.decode(stderr).trim(),
    code,
  };
};

// Run npm commands with proper error handling
const runNpmCommand = async (args: string[], cwd?: string) => {
  const npmCmd = Deno.build.os === 'windows' ? 'npm.cmd' : 'npm';
  const { stdout, stderr, code } = await exec(npmCmd, args, cwd);
  
  if (code !== 0) {
    throw new Error(`Command failed: ${npmCmd} ${args.join(' ')}\n${stderr}`);
  }
  
  return { stdout, stderr };
};

async function build() {
  console.log('🚀 Building AgentLang language server...');
  
  try {
    // 1. Generate Langium parser using the CLI
    console.log('\n🔧 Generating parser...');
    const { stdout: parserOut, stderr: parserErr } = await runNpmCommand(['run', 'langium:generate']);
    if (parserErr) console.error('⚠️  Parser generation warnings:', parserErr);
    console.log(parserOut || '✅ Parser generated successfully');

    // 2. Compile TypeScript to JavaScript
    console.log('\n🔨 Compiling TypeScript...');
    const { stdout: tsOut, stderr: tsErr } = await runNpmCommand(['run', 'build:ts']);
    if (tsErr) console.error('⚠️  TypeScript compilation warnings:', tsErr);
    console.log(tsOut || '✅ TypeScript compilation complete');

    // 3. Bundle for the web if needed
    console.log('\n📦 Bundling for web...');
    const { stdout: viteOut, stderr: viteErr } = await runNpmCommand(['run', 'build:vite']);
    if (viteErr) console.error('⚠️  Vite build warnings:', viteErr);
    console.log(viteOut || '✅ Web bundling complete');
    
    console.log('\n🎉 Build completed successfully!');
  } catch (error) {
    console.error('❌ Build failed:', error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

// Run the build if this file is executed directly
if (import.meta.main) {
  await build();
}
