import { ConfigData } from "./load_config.ts";
import { validateConfigData } from "./validate_config_data.ts";
import { validateScript } from "./validate_script.ts";
import { isWindows, OneOrMore, makeFileExecutable } from "./util.ts";
import { normalizeScript } from "./normalize_script.ts";
import { CompoundCommandItem } from "./command.ts";
import { log } from "./logger.ts";
import { isParallel } from "./command.ts";
import { buildCommandString } from "./build_command_string.ts";
import { escape } from "./util.ts";
import {
  path,
  existsSync,
  readFileStrSync,
  writeFileStr,
  moveSync,
  ensureDirSync,
} from "../deps.ts";

const VR_MARK = "Generated by velociraptor";

export async function exportScripts(
  configData: ConfigData | null,
  scripts: string[],
  outDir: string = "bin",
) {
  validateConfigData(configData);
  const { cwd, config } = configData as ConfigData;
  const outDirPath = path.join(cwd, outDir);
  ensureDirSync(outDirPath);
  if (!scripts || scripts.length < 1) {
    scripts = Object.keys(config.scripts);
  }
  await Promise.all(
    scripts.map(async (script) => {
      validateScript(script, config);
      const scriptDef = config.scripts[script];
      const { scripts, ...rootConfig } = config;
      const commands = normalizeScript(scriptDef, rootConfig);
      const content = generateExecutableFile(commands);
      if (content) {
        const filePath = path.join(outDirPath, script);
        if (
          existsSync(filePath) &&
          !readFileStrSync(filePath).includes(VR_MARK)
        ) {
          moveSync(filePath, `${filePath}.bkp`);
        }
        await writeFileStr(filePath, content);
        makeFileExecutable(filePath);
      }
    }),
  );
}

function generateExecutableFile(
  commands: CompoundCommandItem[],
) {
  if (isWindows) {
    log.warning("Scripts exporting only supports sh.");
  }
  return `#!/bin/sh
# ${VR_MARK}

${exportCommands(commands)}
`;
}

function exportCommands(
  commands: CompoundCommandItem[],
): string {
  const _exportCommands = (
    commands: OneOrMore<CompoundCommandItem>,
    doGroup: boolean = false,
  ): string => {
    if (!commands) return "";
    if (Array.isArray(commands)) {
      let res = commands.map((c) =>
        _exportCommands(c, commands.length > 1 ? true : false)
      ).join(" && ");
      if (doGroup) res = `(${res})`;
      return res;
    } else {
      if (isParallel(commands)) {
        return `(${
          commands.pll.map((c) => _exportCommands(c, true)).join(" & ")
        }; wait)`;
      }
      const cmd = commands;
      let res = "";
      if (cmd.env) {
        const envVars = Object.entries(cmd.env);
        if (envVars.length > 0) {
          res += envVars
            .map(([key, val]) => `${key}="${escape(val, '"')}"`)
            .join(" ") + " ";
        }
      }
      res += buildCommandString(cmd) + ' "$@"';
      if (doGroup) res = `(${res})`;
      return res;
    }
  };
  return _exportCommands(commands);
}
