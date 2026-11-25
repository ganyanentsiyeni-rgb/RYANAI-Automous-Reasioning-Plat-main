import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { RyanAISandbox } from "../engine/sandbox.js";
import { systemDiagnosticsTool } from "../tools/systemTools.js";
import { evaluateGenXSecurityEvent } from "../security/genxPolicy.js";
import { createMcpToolView, assertCanonicalMcpTool } from "./canonicalToolRegistry.js";

const WORKSPACE_DIR = process.cwd();

export class RyanMCPServer {
  private server: Server;

  /** Create the MCP server and install tool handlers without connecting a transport. */
  constructor() {
    this.server = new Server(
      {
        name: "ryanai-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupToolHandlers();
  }

  /**
   * Register workspace reading, script execution, and diagnostics tools.
   * Tool invocation exceptions are converted to MCP text results with isError set.
   */
  private setupToolHandlers() {
    const canonicalTools = createMcpToolView([
      "read_workspace_file",
      "execute_sandbox_script",
      "system_diagnostics",
    ]);

    // List only the tools implemented by this server; identity, capability and
    // approval metadata come from the canonical registry.
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: canonicalTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }));

    // Handle tool execution requests with secure validation and structured error handling
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const canonicalTool = assertCanonicalMcpTool(name);
        const knownTool = canonicalTool && canonicalTools.some((tool) => tool.name === name);
        if (!knownTool) throw new Error(`Unknown MCP tool requested: ${name}`);
        const policy = evaluateGenXSecurityEvent({
          agentId: "external-mcp-client",
          principal: "mcp-client",
          toolName: canonicalTool.name,
          action: name === "execute_sandbox_script" ? "EXECUTE" : "READ",
          target: name === "read_workspace_file" ? String(args?.filePath ?? "") : undefined,
        });
        if (policy.decision !== "ALLOW") {
          return {
            content: [{ type: "text", text: `Gen-X blocked MCP request [${policy.ruleId}]: ${policy.reason}` }],
            isError: true,
          };
        }

        if (name === "read_workspace_file") {
          const filePath = args?.filePath;
          if (typeof filePath !== "string" || !filePath) {
            throw new Error("Missing required argument: 'filePath'");
          }

          const workspaceRoot = await fs.realpath(WORKSPACE_DIR);
          const targetPath = await fs.realpath(path.resolve(WORKSPACE_DIR, filePath));
          const relativePath = path.relative(workspaceRoot, targetPath);
          const resolvedPathPolicy = evaluateGenXSecurityEvent({
            agentId: "external-mcp-client",
            principal: "mcp-client",
            toolName: "read_workspace_file",
            action: "READ",
            target: relativePath,
          });
          if (resolvedPathPolicy.decision !== "ALLOW") {
            throw new Error(`Gen-X denied resolved workspace path [${resolvedPathPolicy.ruleId}].`);
          }
          if (
            relativePath === ".." ||
            relativePath.startsWith(".." + path.sep) ||
            path.isAbsolute(relativePath)
          ) {
            throw new Error(
              "Access denied: Path traversal outside workspace is prohibited.",
            );
          }

          const content = await fs.readFile(targetPath, "utf-8");
          return {
            content: [{ type: "text", text: content }],
          };
        }

        if (name === "execute_sandbox_script") {
          const { scriptContent, fileName } = args ?? {};
          if (typeof scriptContent !== "string" || !scriptContent) {
            throw new Error("Missing required argument: 'scriptContent'");
          }

          const result = await RyanAISandbox.executeInSandbox(
            scriptContent,
            typeof fileName === "string" ? fileName : "mcp_payload.js",
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        if (name === "system_diagnostics") {
          const result = await systemDiagnosticsTool.invoke(
            await systemDiagnosticsTool.schema.parseAsync(args),
          );
          return {
            content: [
              {
                type: "text",
                text:
                  typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        throw new Error(`Unknown MCP tool requested: ${name}`);
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing tool [${name}]: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /** Connect the MCP server to standard input/output; connection errors propagate. */
  public async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(
      "[RyanAI MCP Server] Model Context Protocol server running on stdio.",
    );
  }
}
