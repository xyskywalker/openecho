import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import process from "node:process";
import TextInput from "ink-text-input";

export interface CommandItem {
  title: string;
  value: string;
  description: string;
}

type ExecBuiltinCommand = (command: string) => Promise<string | null>;
type ExecChat = (message: string) => AsyncIterable<
  | { type: "text"; content: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string }
  | { type: "error"; message: string }
  | { type: "done" }
>;

export interface TuiHooks {
  execSelect: (
    message: string,
    choices: Array<{ title: string; value: string; description?: string }>,
  ) => Promise<string | null>;
  execInput: (message: string) => Promise<string>;
  execConfirm: (message: string) => Promise<boolean>;
}

interface TuiAppProps {
  introLines: string[];
  promptPrefix: () => string;
  commands: CommandItem[];
  commandsNeedArgs: string[];
  execBuiltinCommand: ExecBuiltinCommand;
  execChat: ExecChat;
  onReady?: (hooks: TuiHooks) => void;
  onExit: () => void;
}

type Line = { kind: "info" | "user" | "assistant" | "error"; text: string };

function maskSecret(value: string): string {
  const v = value.trim();
  if (v.length <= 12) return "***";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function formatFormLog(message: string, value: string): string {
  const lower = message.toLowerCase();
  const looksSensitive = lower.includes("key") || lower.includes("token") || lower.includes("secret");
  const displayed = looksSensitive ? maskSecret(value) : value;
  return `${message}: ${displayed}`;
}

function filterCommands(commands: CommandItem[], query: string): CommandItem[] {
  const q = query.toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => {
    const hay = `${c.value} ${c.title} ${c.description}`.toLowerCase();
    return hay.includes(q);
  });
}

function getCommandBase(command: string): string {
  return command.trim().split(/\s+/)[0] ?? command;
}

function buildCommandTree(commands: CommandItem[]): {
  roots: CommandItem[];
  childrenByRoot: Map<string, CommandItem[]>;
} {
  const childrenByRoot = new Map<string, CommandItem[]>();
  const rootByValue = new Map<string, CommandItem>();

  for (const cmd of commands) {
    const root = getCommandBase(cmd.value);
    if (cmd.value === root) {
      rootByValue.set(root, cmd);
      continue;
    }

    const list = childrenByRoot.get(root) ?? [];
    list.push(cmd);
    childrenByRoot.set(root, list);
  }

  // 如果只有子命令但没有显式 root 定义，则补一个 root
  for (const root of childrenByRoot.keys()) {
    if (rootByValue.has(root)) continue;

    // 尽量给自动补齐的 root 加可读描述（例如 /identity）
    const desc = (() => {
      const children = childrenByRoot.get(root) ?? [];
      if (children.length === 0) return "";
      const example = children
        .map((c) => c.value)
        .slice(0, 3)
        .join(", ");
      return example ? `子命令: ${example}` : "";
    })();

    rootByValue.set(root, { title: root, value: root, description: desc });
  }

  const roots = Array.from(rootByValue.values()).sort((a, b) => a.value.localeCompare(b.value));
  for (const [root, list] of childrenByRoot.entries()) {
    childrenByRoot.set(
      root,
      list.slice().sort((a, b) => a.value.localeCompare(b.value)),
    );
  }

  return { roots, childrenByRoot };
}

function CommandPalette(props: {
  commands: CommandItem[];
  query: string;
  selectedIndex: number;
  title?: string;
}): React.ReactElement {
  const { commands, query, selectedIndex } = props;
  const visible = useMemo(() => filterCommands(commands, query), [commands, query]);
  const sliced = visible.slice(0, 10);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">{props.title ?? "Command"}</Text>
      <Text color="gray">Type to filter, ↑↓ select, Enter run, Esc cancel</Text>
      <Box height={1} />
      {sliced.length === 0 ? (
        <Text color="gray">No matches</Text>
      ) : (
        sliced.map((cmd, i) => {
          const selected = i === selectedIndex;
          return (
            <Text key={cmd.value}>
              <Text color={selected ? "cyan" : "gray"}>{selected ? "❯ " : "  "}</Text>
              <Text color={selected ? "cyan" : undefined}>{cmd.value}</Text>
              <Text color="gray">  {cmd.description}</Text>
            </Text>
          );
        })
      )}
    </Box>
  );
}

function ArgsPrompt(props: {
  command: string;
  value: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <Box>
      <Text color="gray">{props.command} 参数 › </Text>
      <TextInput value={props.value} onChange={props.onChange} />
    </Box>
  );
}

function InputPrompt(props: {
  prefix: string;
  value: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <Box>
      {props.prefix ? <Text color="gray">{props.prefix}</Text> : null}
      <Text color="green">你</Text>
      <Text color="gray"> › </Text>
      <TextInput value={props.value} onChange={props.onChange} />
    </Box>
  );
}

function TuiApp(props: TuiAppProps): React.ReactElement {
  const { exit } = useApp();

  const hardExit = useCallback(() => {
    props.onExit();
    // onExit 会做全局 hardExit，这里只触发 Ink 清理即可
    exit();
  }, [exit, props]);

  const [lines, setLines] = useState<Line[]>(() =>
    props.introLines.map((text) => ({ kind: "info", text })),
  );

  const linesRef = useRef<Line[]>([]);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"chat" | "palette" | "args">("chat");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteSelected, setPaletteSelected] = useState(0);
  const [paletteRoot, setPaletteRoot] = useState<string | null>(null);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [args, setArgs] = useState("");

  const [blocking, setBlocking] = useState<
    | null
    | { kind: "select"; message: string; choices: Array<{ title: string; value: string; description?: string }> }
    | { kind: "input"; message: string }
    | { kind: "confirm"; message: string }
  >(null);
  const [blockValue, setBlockValue] = useState("");
  const [blockSelected, setBlockSelected] = useState(0);
  const blockResolve = useRef<((v: any) => void) | null>(null);

  const [waiting, setWaiting] = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const spinnerFrames = useMemo(() => ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"], []);

  const [statusText, setStatusText] = useState<string | null>(null);

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setSpinnerFrame((f) => (f + 1) % spinnerFrames.length), 80);
    return () => clearInterval(id);
  }, [spinnerFrames.length, waiting]);

  const isBusyRef = useRef(false);
  const { roots: paletteRoots, childrenByRoot } = useMemo(
    () => buildCommandTree(props.commands),
    [props.commands],
  );

  const paletteItems = useMemo(() => {
    if (!paletteRoot) return paletteRoots;
    const raw = childrenByRoot.get(paletteRoot) ?? [];
    const rootItem = paletteRoots.find((r) => r.value === paletteRoot);
    if (!rootItem) return raw;
    if (raw.length === 0) return raw;

    // 只有当该 root 本身在原始命令集中存在时，才允许执行无参数版本。
    // 例如 /config、/heartbeat 是可执行 root；而 /identity 只是分组，不应显示默认项。
    const rootExecutable = props.commands.some((c) => c.value === paletteRoot);
    if (!rootExecutable) return raw;

    return [
      {
        title: `${paletteRoot} (默认)`,
        value: paletteRoot,
        description: rootItem.description || "执行无参数版本",
      },
      ...raw,
    ];
  }, [childrenByRoot, paletteRoot, paletteRoots, props.commands]);

  const appendLine = useCallback((line: Line) => {
    setLines((prev) => [...prev, line]);
  }, []);

  const updateLineText = useCallback((index: number, text: string) => {
    setLines((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.slice();
      next[index] = { ...next[index], text };
      return next;
    });
  }, []);

  useEffect(() => {
    const hooks: TuiHooks = {
      execSelect: async (message, choices) => {
        setBlocking({ kind: "select", message, choices });
        setBlockSelected(0);
        return await new Promise<string | null>((resolve) => {
          blockResolve.current = resolve;
        });
      },
      execInput: async (message) => {
        setBlocking({ kind: "input", message });
        setBlockValue("");
        return await new Promise<string>((resolve) => {
          blockResolve.current = resolve;
        });
      },
      execConfirm: async (message) => {
        setBlocking({ kind: "confirm", message });
        return await new Promise<boolean>((resolve) => {
          blockResolve.current = resolve;
        });
      },
    };

    props.onReady?.(hooks);

    return () => {
      // nothing
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (旧的 props 注入方式已移除，改用 onReady 回调)

  const runBuiltin = useCallback(
    async (command: string) => {
      setWaiting(true);
      setStatusText(`运行命令 ${command}`);
      const result = await props.execBuiltinCommand(command);
      setWaiting(false);
      setStatusText(null);
      if (result) appendLine({ kind: "assistant", text: result });
    },
    [appendLine, props],
  );

  const [streamingText, setStreamingText] = useState<string | null>(null);
  const streamingTextRef = useRef<string | null>(null);
  useEffect(() => {
    streamingTextRef.current = streamingText;
  }, [streamingText]);

  const runChat = useCallback(
    async (message: string) => {
      let assistantText = "";
      let gotFirstToken = false;

      setStreamingText("");
      setWaiting(true);
      setStatusText("等待模型响应…");

      for await (const event of props.execChat(message)) {
        if (event.type === "text") {
          if (!gotFirstToken) {
            gotFirstToken = true;
            setWaiting(false);
            setStatusText(null);
          }
          assistantText += event.content;
          setStreamingText(assistantText);
        } else if (event.type === "tool_start") {
          if (!gotFirstToken) {
            gotFirstToken = true;
            setWaiting(false);
          }

          // 显示完整工具名
          setStatusText(`执行工具 ${event.name}…`);
          assistantText += `\n[执行: ${event.name}]`;
          setStreamingText(assistantText);
        } else if (event.type === "tool_end") {
          assistantText += " ✓";
          setStreamingText(assistantText);
          // 工具执行完通常还会继续让模型整理输出
          setWaiting(true);
          setStatusText("整理结果中…");
        } else if (event.type === "error") {
          setWaiting(false);
          setStatusText(null);
          setStreamingText(null);
          appendLine({ kind: "error", text: `错误: ${event.message}` });
          return;
        }
      }

      setWaiting(false);
      setStatusText(null);
      setStreamingText(null);
      if (assistantText.trim()) appendLine({ kind: "assistant", text: assistantText });
    },
    [appendLine, props],
  );

  const visiblePalette = useMemo(() => {
    const visible = filterCommands(paletteItems, paletteQuery);
    return visible.slice(0, 10);
  }, [paletteItems, paletteQuery]);

  useEffect(() => {
    if (mode !== "palette") return;
    setPaletteSelected(0);
  }, [mode, paletteQuery, visiblePalette.length]);

  const openPalette = useCallback(
    (initialQuery: string) => {
      setMode("palette");
      setPaletteRoot(null);
      setPaletteQuery(initialQuery);
      setPaletteSelected(0);
    },
    [],
  );

  const closePalette = useCallback(() => {
    setMode("chat");
    setPaletteQuery("");
    setPaletteSelected(0);
    setPaletteRoot(null);
  }, []);

  const openSubPalette = useCallback((root: string) => {
    setPaletteRoot(root);
    setPaletteQuery("");
    setPaletteSelected(0);
  }, []);

  const beginArgs = useCallback((command: string) => {
    setPendingCommand(command);
    setArgs("");
    setMode("args");
  }, []);

  const finishArgs = useCallback(async () => {
    if (!pendingCommand) {
      setMode("chat");
      return;
    }
    const finalCommand = args.trim() ? `${pendingCommand} ${args.trim()}` : pendingCommand;
    setPendingCommand(null);
    setArgs("");
    setMode("chat");
    await runBuiltin(finalCommand);
  }, [args, pendingCommand, runBuiltin]);

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      isBusyRef.current = true;
      try {
        if (trimmed.startsWith("/")) {
          const cmdBase = trimmed.split(" ")[0];
          const hasArgs = trimmed.includes(" ") && trimmed.split(" ").length > 1;
          if (props.commandsNeedArgs.includes(cmdBase) && !hasArgs) {
            beginArgs(cmdBase);
            return;
          }
          await runBuiltin(trimmed);
        } else {
          appendLine({ kind: "user", text: trimmed });
          await runChat(trimmed);
        }
      } finally {
        isBusyRef.current = false;
      }
    },
    [appendLine, beginArgs, props.commandsNeedArgs, runBuiltin, runChat],
  );

  useInput((inputKey, key) => {
    // 无论处于什么模式（包括 blocking 输入），Ctrl+C 都要立刻退出
    if (key.ctrl && inputKey === "c") {
      hardExit();
      return;
    }

    if (blocking) {
      if (key.escape) {
        const resolve = blockResolve.current;
        blockResolve.current = null;
        setBlocking(null);
        if (blocking.kind === "select") resolve?.(null);
        else if (blocking.kind === "input") resolve?.("");
        else resolve?.(false);
        return;
      }
      if (blocking.kind === "select") {
        const visible = blocking.choices;
        if (key.upArrow) {
          setBlockSelected((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setBlockSelected((i) => Math.min(Math.max(0, visible.length - 1), i + 1));
          return;
        }
        if (key.return) {
          const selected = visible[blockSelected];
          const resolve = blockResolve.current;
          blockResolve.current = null;
          setBlocking(null);
          resolve?.(selected?.value ?? null);
          return;
        }
        return;
      }
      if (blocking.kind === "input") {
        if (key.return) {
          const resolve = blockResolve.current;
          blockResolve.current = null;
          setBlocking(null);
          // 将表单输入持久化到界面，避免下一步覆盖后“消失”
          appendLine({ kind: "info", text: formatFormLog(blocking.message, blockValue) });
          resolve?.(blockValue);
          return;
        }
        return;
      }
      if (blocking.kind === "confirm") {
        if (key.return) {
          const resolve = blockResolve.current;
          blockResolve.current = null;
          setBlocking(null);
          resolve?.(true);
          return;
        }
        if (inputKey.toLowerCase() === "n") {
          const resolve = blockResolve.current;
          blockResolve.current = null;
          setBlocking(null);
          resolve?.(false);
          return;
        }
        return;
      }
    }

    // Ctrl+C 已在函数顶部统一处理

    if (mode === "palette") {
      if (key.escape) {
        if (paletteRoot) {
          setPaletteRoot(null);
          setPaletteQuery("");
          setPaletteSelected(0);
        } else {
          closePalette();
        }
        return;
      }
      if (key.upArrow) {
        setPaletteSelected((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setPaletteSelected((i) => Math.min(Math.max(0, visiblePalette.length - 1), i + 1));
        return;
      }
      if (key.return) {
        const selected = visiblePalette[paletteSelected];
        if (selected) {
          // root 级：如果有子命令，则进入二级；否则直接执行
          if (!paletteRoot) {
            const root = selected.value;
            const children = childrenByRoot.get(root) ?? [];
            if (children.length > 0) {
              openSubPalette(root);
              return;
            }
          }

          closePalette();
          setInput("");
          void submit(selected.value);
        } else {
          closePalette();
        }
        return;
      }
      return;
    }

    if (mode === "args") {
      if (key.escape) {
        setPendingCommand(null);
        setArgs("");
        setMode("chat");
        return;
      }
      if (key.return) {
        void finishArgs();
        return;
      }
      return;
    }

    // chat mode
    if (!key.ctrl && !key.meta && !key.shift && inputKey === "/" && input === "") {
      openPalette("");
      return;
    }
    if (key.ctrl && inputKey.toLowerCase() === "k") {
      openPalette("");
      return;
    }
    if (key.return) {
      const current = input;
      setInput("");
      void submit(current);
      return;
    }
  });

  // 防止输入框在 palette 打开时仍然接收输入
  useEffect(() => {
    if (mode === "palette") {
      // paletteQuery 由 TextInput 维护，这里不做额外处理
    }
  }, [mode]);

  const prefix = props.promptPrefix();

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        {lines.map((l, idx) => {
          if (l.kind === "info") return <Text key={idx} color="gray">{l.text}</Text>;
          if (l.kind === "user") {
            return (
              <Box key={idx} flexDirection="column" marginBottom={1}>
                <Text color="green">你</Text>
                <Text color="greenBright">{l.text}</Text>
              </Box>
            );
          }
          if (l.kind === "error") return <Text key={idx} color="red">{l.text}</Text>;
          return (
            <Box key={idx} flexDirection="column" marginBottom={1}>
              <Text color="blue">回声</Text>
              <Text color="cyan">{l.text}</Text>
            </Box>
          );
        })}
      </Box>

      {streamingTextRef.current !== null ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="blue">回声</Text>
          <Text color="cyan">{streamingTextRef.current}</Text>
        </Box>
      ) : null}

      {mode === "palette" ? (
        <>
          <CommandPalette
            commands={paletteItems}
            query={paletteQuery}
            selectedIndex={paletteSelected}
            title={paletteRoot ? `Command ${paletteRoot}` : "Command"}
          />
          <Box>
            <Text color="gray">/</Text>
            <TextInput value={paletteQuery} onChange={setPaletteQuery} />
          </Box>
        </>
      ) : mode === "args" && pendingCommand ? (
        <ArgsPrompt command={pendingCommand} value={args} onChange={setArgs} />
      ) : blocking ? (
        blocking.kind === "select" ? (
          <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
            <Text>{blocking.message}</Text>
            <Box height={1} />
            {blocking.choices.map((c, i) => {
              const selected = i === blockSelected;
              return (
                <Text key={c.value}>
                  <Text color={selected ? "cyan" : "gray"}>{selected ? "❯ " : "  "}</Text>
                  <Text color={selected ? "cyan" : undefined}>{c.title}</Text>
                  {c.description ? <Text color="gray">  {c.description}</Text> : null}
                </Text>
              );
            })}
            <Box height={1} />
            <Text color="gray">Enter 确认，Esc 取消</Text>
          </Box>
        ) : blocking.kind === "input" ? (
          <Box>
            <Text>{blocking.message} </Text>
            <TextInput value={blockValue} onChange={setBlockValue} />
          </Box>
        ) : (
          <Box>
            <Text>{blocking.message} </Text>
            <Text color="gray">(Enter=Yes, n=No, Esc=Cancel)</Text>
          </Box>
        )
      ) : (
        <Box flexDirection="column">
          {waiting ? (
            <Box>
              <Text color="cyan">{spinnerFrames[spinnerFrame]}</Text>
              <Text color="gray"> {statusText ?? "处理中…"}</Text>
            </Box>
          ) : null}
          <InputPrompt prefix={prefix} value={input} onChange={setInput} />
        </Box>
      )}
    </Box>
  );
}

export function runTuiInk(props: TuiAppProps): void {
  if (!process.stdin.isTTY) {
    // 该错误常见于：在非交互环境（例如被管道/重定向/测试 runner）启动。
    // Ink 需要 TTY 才能开启 raw mode 捕获按键。
    throw new Error("Ink TUI 需要在交互式 TTY 中运行（stdin 必须是 TTY）。请直接在终端运行: openecho tui");
  }
  render(<TuiApp {...props} />, {
    // 在非 TTY/管道环境下，stdin 不支持 raw mode，会直接崩。
    // 这里显式要求使用真实 TTY。
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
