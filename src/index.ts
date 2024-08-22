import type { Plugin, ResolvedConfig } from "vite";
import { gzipSync } from "zlib";
import { writeFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import ejs from "ejs";
import type { NormalizedOutputOptions, OutputAsset, OutputChunk } from "rollup";
import mime from "mime-types";
import path from "path";

interface Asset {
  path: string;
  normalizedName: string;
  mimeType: string;
  contents: string;
  size: number;
}

/**
 * @param logging Whether or not to enable console output during build. Defaults to false
 * @param includePublic Whether or not to include static files from Vite's `public/` folder. Defaults to true
 * @param enforce Enforce plugin invocation tier similar to webpack loaders.
 */
export interface PluginConfig {
  logging?: boolean;
  includePublic?: boolean;
  enforce?: Plugin["enforce"];
}

export function espViteBuild(
  configParams: PluginConfig = {
    logging: false,
    includePublic: true,
  }
): Plugin {
  let config: ResolvedConfig;
  let assets: Asset[] = [];

  function addAsset(
    filename: string,
    data: OutputAsset | OutputChunk,
    options: NormalizedOutputOptions
  ) {
    // get path of asset
    const path = `${options.dir}/${filename}`;
    const mimeType = mime.lookup(path);
    if (!mimeType) {
      console.log("No mime type found for", path);
      return;
    }
    const asset = optimizeAsset(
      data.type === "asset" ? data.source : data.code
    );
    assets.push({
      path: "/" + filename,
      normalizedName: filename.replace(/[^0-9a-z]/gi, "_"),
      mimeType,
      ...asset,
    });
  }

  function optimizeAsset(sourceData: string | Uint8Array) {
    let response: string = "";
    let contents = gzipSync(sourceData);
    for (var i = 0; i < contents.length; i++) {
      if (i % 16 == 0) {
        response += "\n";
      }
      response += "0x" + ("00" + contents[i].toString(16)).slice(-2);
      if (i < contents.length - 1) {
        response += ", ";
      }
    }

    return {
      contents: response,
      size: contents.length,
    };
  }

  function createESPOutputFile(options: NormalizedOutputOptions) {
    const templatePath = path.resolve(__dirname, "static_files_h.ejs");
    ejs.renderFile(templatePath, { files: assets }, {}, (err, str) => {
      if (err) {
        console.error("Error rendering EJS File:", err);
        return;
      }
      const outputPath = path.join(
        options.dir ?? "",
        "_esp32",
        "static_files.h"
      );

      // Ensure the directory exists before writing the file
      const dirPath = path.dirname(outputPath);
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }

      // Write the file to the created directory
      writeFileSync(outputPath, str);
      console.log("Wrote", outputPath);
    });
  }

  return {
    name: "vite-plugin-preact-esp32",
    enforce: configParams.enforce,
    apply: "build",
    configResolved(_config) {
      config = _config
    },
    writeBundle(options, bundle) {
      for (const [filename, data] of Object.entries(bundle)) {
        console.log("Processing", filename);
        if (data) {
          addAsset(filename, data, options);
        }
      }
      if (configParams.includePublic) {
        const publicDirFiles = readdirSync(config.publicDir);
        for (const filename of publicDirFiles) {
          console.log("Processing", filename);
          const filePath = path.join(config.publicDir, filename);
          const data = {
            type: "asset",
            source: new Uint8Array(
              readFileSync(filePath)
            ),
            fileName: filename,
            name: filename,
            needsCodeReference: false,
          } satisfies OutputAsset;
          addAsset(filename, data, options);
        }
      }
      console.log("Creating ESP Output");
      createESPOutputFile(options);
    },
  };
}
