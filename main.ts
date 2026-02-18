import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";

interface WordCloudSettings {
  minFontSize: number;
  maxFontSize: number;
  colorPalette: string[];
  separator: string;
  spacing: "compact" | "normal" | "comfortable" | "loose";
  autoFontSize: boolean;
  autoSpacing: boolean;
  casing: "as-is" | "uppercase" | "lowercase" | "title-case";
}

const DEFAULT_SETTINGS: WordCloudSettings = {
  minFontSize: 12,
  maxFontSize: 48,
  colorPalette: ["#0066cc", "#cc6600", "#cc0066", "#6600cc", "#00cc66"],
  separator: ",",
  spacing: "normal",
  autoFontSize: true,
  autoSpacing: true,
  casing: "as-is",
};

// Spacing configurations
const SPACING_CONFIG = {
  compact: { padding: 3, margin: 5, startRadius: 1, spiralStep: 1.5 },
  normal: { padding: 12, margin: 12, startRadius: 5, spiralStep: 4 },
  comfortable: { padding: 22, margin: 18, startRadius: 12, spiralStep: 7 },
  loose: { padding: 35, margin: 25, startRadius: 20, spiralStep: 10 },
};

type SpacingConfig = typeof SPACING_CONFIG["normal"];

// Auto-calculated spacing based on word count and screen size
function getAutoSpacing(
  wordCount: number,
  isMobile: boolean = false
): SpacingConfig {
  if (isMobile) {
    if (wordCount <= 10) return SPACING_CONFIG["comfortable"];
    else if (wordCount <= 20) return SPACING_CONFIG["normal"];
    else return SPACING_CONFIG["compact"];
  }
  if (wordCount <= 10) return SPACING_CONFIG["loose"];
  else if (wordCount <= 20) return SPACING_CONFIG["comfortable"];
  else if (wordCount <= 40) return SPACING_CONFIG["normal"];
  else return SPACING_CONFIG["compact"];
}

// Apply casing transformation to text
function applyCasing(
  text: string,
  casing: "as-is" | "uppercase" | "lowercase" | "title-case"
): string {
  switch (casing) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "title-case": {
      const words = text.toLowerCase().split(" ");
      if (words.length === 1) {
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
      } else {
        const smallWords = [
          "a",
          "an",
          "and",
          "as",
          "at",
          "but",
          "by",
          "for",
          "in",
          "of",
          "on",
          "or",
          "the",
          "to",
          "with",
        ];
        return words
          .map((word, index) => {
            if (
              index === 0 ||
              index === words.length - 1 ||
              !smallWords.includes(word)
            ) {
              return word.charAt(0).toUpperCase() + word.slice(1);
            }
            return word;
          })
          .join(" ");
      }
    }
    case "as-is":
    default:
      return text;
  }
}

// Auto-calculated font sizes based on word count and screen size
function getAutoFontSizes(
  wordCount: number,
  isMobile: boolean = false
): { min: number; max: number } {
  if (isMobile) {
    if (wordCount <= 10) return { min: 14, max: 32 };
    else if (wordCount <= 20) return { min: 12, max: 26 };
    else if (wordCount <= 40) return { min: 10, max: 20 };
    else if (wordCount <= 70) return { min: 9, max: 16 };
    else return { min: 8, max: 14 };
  }
  if (wordCount <= 10) return { min: 20, max: 56 };
  else if (wordCount <= 20) return { min: 16, max: 40 };
  else if (wordCount <= 40) return { min: 14, max: 32 };
  else if (wordCount <= 70) return { min: 12, max: 28 };
  else return { min: 10, max: 22 };
}

interface PlacedRect {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation: number;
}

interface WordData {
  width: number;
  height: number;
  fontSize: number;
  color: string;
  rotation: number;
  word: string;
  isCentered: boolean;
}

export default class WordCloudPlugin extends Plugin {
  settings: WordCloudSettings;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("cloud", "Generate word cloud", (evt: MouseEvent) => {
      new WordCloudModal(this.app, this).open();
    });

    this.addCommand({
      id: "insert-cloud",
      name: "Insert cloud",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        new WordCloudModal(this.app, this, editor).open();
      },
    });

    this.registerMarkdownCodeBlockProcessor("wordcloud", (source, el, ctx) => {
      this.renderWordCloud(source, el);
    });

    this.addSettingTab(new WordCloudSettingTab(this.app, this));
  }

  renderWordCloud(source: string, container: HTMLElement) {
    container.empty();
    container.addClass("word-cloud-container");

    const separator = this.settings.separator || ",";
    const rawWords = source
      .split(separator)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);
    const words = rawWords.map((word) =>
      applyCasing(word, this.settings.casing)
    );

    if (words.length === 0) {
      container.createEl("p", {
        text: `No words provided. Add ${separator}-separated words.`,
      });
      return;
    }

    const colors =
      this.settings.colorPalette.length > 0
        ? this.settings.colorPalette
        : DEFAULT_SETTINGS.colorPalette;

    const getContainerWidth = () => {
      if (container.offsetWidth > 0) return container.offsetWidth;
      if (typeof window !== "undefined")
        return Math.min(window.innerWidth - 40, 700);
      return 700;
    };

    const containerWidth = getContainerWidth();
    const isMobile = containerWidth < 500;

    let minFontSize: number;
    let maxFontSize: number;
    if (this.settings.autoFontSize) {
      const autoSizes = getAutoFontSizes(words.length, isMobile);
      minFontSize = autoSizes.min;
      maxFontSize = autoSizes.max;
    } else {
      minFontSize = this.settings.minFontSize;
      maxFontSize = this.settings.maxFontSize;
    }

    let spacingConfig: SpacingConfig;
    if (this.settings.autoSpacing) {
      spacingConfig = getAutoSpacing(words.length, isMobile);
    } else {
      spacingConfig = SPACING_CONFIG[this.settings.spacing || "normal"];
    }

    const containerHeight = isMobile ? 400 : 500;
    container.setCssProps({
      "--wc-height": containerHeight + "px",
      "--wc-position": "relative",
    });
    container.addClass("word-cloud-sized");

    const renderWords = (centeredWord: string | null = null) => {
      container.empty();

      let shuffledWords: string[];
      if (centeredWord) {
        const otherWords = words.filter((w) => w !== centeredWord);
        shuffledWords = [
          centeredWord,
          ...otherWords.sort(() => Math.random() - 0.5),
        ];
      } else {
        shuffledWords = [...words].sort(() => Math.random() - 0.5);
      }

      const placedElements: PlacedRect[] = [];

      const checkOverlap = (rect1: PlacedRect, rect2: PlacedRect): boolean => {
        const padding = spacingConfig.padding;

        let w1 = rect1.width;
        let h1 = rect1.height;
        if (Math.abs(rect1.rotation) === 90) {
          [w1, h1] = [h1, w1];
        }

        let w2 = rect2.width;
        let h2 = rect2.height;
        if (Math.abs(rect2.rotation) === 90) {
          [w2, h2] = [h2, w2];
        }

        const left1 = rect1.centerX - w1 / 2 - padding;
        const right1 = rect1.centerX + w1 / 2 + padding;
        const top1 = rect1.centerY - h1 / 2 - padding;
        const bottom1 = rect1.centerY + h1 / 2 + padding;

        const left2 = rect2.centerX - w2 / 2 - padding;
        const right2 = rect2.centerX + w2 / 2 + padding;
        const top2 = rect2.centerY - h2 / 2 - padding;
        const bottom2 = rect2.centerY + h2 / 2 + padding;

        return !(
          right1 < left2 ||
          left1 > right2 ||
          bottom1 < top2 ||
          top1 > bottom2
        );
      };

      const tempElements: WordData[] = [];

      const canvas = document.createElement("canvas");
      let ctx: CanvasRenderingContext2D | null = null;

      try {
        ctx = canvas.getContext("2d");
      } catch (error) {
        console.error("Canvas context error:", error);
      }

      if (!ctx) {
        console.error("Could not get canvas context");
        shuffledWords.forEach((word) => {
          const isCentered = centeredWord === word;
          const fontSize = isCentered
            ? Math.floor((maxFontSize + minFontSize) / 2 + 10)
            : Math.floor(Math.random() * (maxFontSize - minFontSize + 1)) +
              minFontSize;

          const color = colors[Math.floor(Math.random() * colors.length)];
          const rotations = isCentered ? [0] : [0, 0, 0, 0, 90, -90];
          const rotation =
            rotations[Math.floor(Math.random() * rotations.length)];
          const width = Math.ceil(word.length * fontSize * 0.6) + 8;
          const height = fontSize + 8;

          tempElements.push({
            width,
            height,
            fontSize,
            color,
            rotation,
            word,
            isCentered,
          });
        });

        requestAnimationFrame(() => {
          setTimeout(() => {
            positionWords();
          }, 50);
        });
        return;
      }

      const context: CanvasRenderingContext2D = ctx;

      shuffledWords.forEach((word) => {
        const isCentered = centeredWord === word;
        const fontSize = isCentered
          ? Math.floor((maxFontSize + minFontSize) / 2 + 10)
          : Math.floor(Math.random() * (maxFontSize - minFontSize + 1)) +
            minFontSize;

        const color = colors[Math.floor(Math.random() * colors.length)];
        const rotations = isCentered ? [0] : [0, 0, 0, 0, 90, -90];
        const rotation =
          rotations[Math.floor(Math.random() * rotations.length)];

        const fontFamily = container.isConnected
          ? getComputedStyle(container).fontFamily || "Arial, sans-serif"
          : "Arial, sans-serif";
        (
          context
        ).font = `bold ${fontSize}px ${fontFamily}`;
        const metrics = context.measureText(word);
        const width = Math.ceil(metrics.width) + 8;
        const height = fontSize + 8;

        tempElements.push({
          width,
          height,
          fontSize,
          color,
          rotation,
          word,
          isCentered,
        });
      });

      requestAnimationFrame(() => {
        setTimeout(() => {
          positionWords();
        }, 50);
      });

      const positionWords = () => {
        if (!centeredWord) {
          tempElements.sort((a, b) => b.width * b.height - a.width * a.height);
        }

        const centerX = containerWidth / 2;
        const centerY = containerHeight / 2;

        tempElements.forEach((temp) => {
          const tag = container.createEl("span");
          tag.addClass("word-cloud-word");
          tag.textContent = temp.word;
          tag.setCssProps({
            "--wc-font-size": temp.fontSize + "px",
            "--wc-color": temp.color,
          });

          const tagWidth = temp.width;
          const tagHeight = temp.height;
          const rotation = temp.rotation;
          const isCentered = temp.isCentered;

          let placed = false;

          if (isCentered) {
            const x = centerX - tagWidth / 2;
            const y = centerY - tagHeight / 2;

            tag.setCssProps({
              "--wc-left": x + "px",
              "--wc-top": y + "px",
              "--wc-transform": `rotate(${rotation}deg) scale(1.2)`,
              "--wc-z-index": "50",
            });
            tag.addClass("word-cloud-word--centered");

            placedElements.push({
              centerX,
              centerY,
              width: tagWidth * 1.5,
              height: tagHeight * 1.5,
              rotation,
            });
            placed = true;
          } else {
            let spiralRadius = 120;
            const spiralStep = spacingConfig.spiralStep;
            const angleStep = 0.08;
            let angle = Math.random() * Math.PI * 2;

            const maxRadius = Math.max(containerWidth, containerHeight) * 2;
            const maxAttempts = 20000;
            let attempts = 0;

            while (
              !placed &&
              spiralRadius < maxRadius &&
              attempts < maxAttempts
            ) {
              const testCenterX = centerX + spiralRadius * Math.cos(angle);
              const testCenterY = centerY + spiralRadius * Math.sin(angle);

              let neededWidth = tagWidth;
              let neededHeight = tagHeight;
              if (Math.abs(rotation) === 90) {
                [neededWidth, neededHeight] = [neededHeight, neededWidth];
              }

              const left = testCenterX - neededWidth / 2;
              const right = testCenterX + neededWidth / 2;
              const top = testCenterY - neededHeight / 2;
              const bottom = testCenterY + neededHeight / 2;

              const margin = spacingConfig.margin;
              if (
                left >= margin &&
                right <= containerWidth - margin &&
                top >= margin &&
                bottom <= containerHeight - margin
              ) {
                const testRect: PlacedRect = {
                  centerX: testCenterX,
                  centerY: testCenterY,
                  width: tagWidth,
                  height: tagHeight,
                  rotation,
                };

                let hasOverlap = false;
                for (let i = 0; i < placedElements.length; i++) {
                  if (checkOverlap(testRect, placedElements[i])) {
                    hasOverlap = true;
                    break;
                  }
                }

                if (!hasOverlap) {
                  const x = testCenterX - tagWidth / 2;
                  const y = testCenterY - tagHeight / 2;

                  tag.setCssProps({
                    "--wc-left": x + "px",
                    "--wc-top": y + "px",
                    "--wc-transform": `rotate(${rotation}deg)`,
                    "--wc-z-index": "1",
                  });

                  placedElements.push(testRect);
                  placed = true;
                }
              }

              angle += angleStep;
              spiralRadius += spiralStep * (angleStep / (2 * Math.PI));
              attempts++;
            }

            if (!placed) {
              tag.remove();
            }
          }

          if (placed) {
            tag.dataset.rotation = String(rotation);
            tag.dataset.isCentered = String(isCentered);

            tag.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              renderWords(temp.word);
            });

            tag.addEventListener("touchend", (e) => {
              e.preventDefault();
              e.stopPropagation();
              renderWords(temp.word);
            });

            tag.addEventListener("mouseenter", () => {
              if (!isCentered) {
                const rot = parseInt(tag.dataset.rotation || "0");
                tag.setCssProps({
                  "--wc-transform": `rotate(${rot}deg) scale(1.1)`,
                  "--wc-z-index": "100",
                });
              }
            });

            tag.addEventListener("mouseleave", () => {
              if (!isCentered) {
                const rot = parseInt(tag.dataset.rotation || "0");
                tag.setCssProps({
                  "--wc-transform": `rotate(${rot}deg) scale(1)`,
                  "--wc-z-index": "1",
                });
              }
            });

            let touchScaleTimeout: number;

            tag.addEventListener("touchstart", () => {
              if (!isCentered) {
                const rot = parseInt(tag.dataset.rotation || "0");
                tag.setCssProps({
                  "--wc-transform": `rotate(${rot}deg) scale(1.1)`,
                  "--wc-z-index": "100",
                });
                if (touchScaleTimeout) window.clearTimeout(touchScaleTimeout);
              }
            });

            tag.addEventListener("touchcancel", () => {
              if (!isCentered) {
                touchScaleTimeout = window.setTimeout(() => {
                  const rot = parseInt(tag.dataset.rotation || "0");
                  tag.setCssProps({
                    "--wc-transform": `rotate(${rot}deg) scale(1)`,
                    "--wc-z-index": "1",
                  });
                }, 100);
              }
            });
          }
        });
      };
    };

    setTimeout(() => {
      const randomWord = words[Math.floor(Math.random() * words.length)];
      renderWords(randomWord);
    }, 100);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class WordCloudModal extends Modal {
  plugin: WordCloudPlugin;
  editor?: Editor;

  constructor(app: App, plugin: WordCloudPlugin, editor?: Editor) {
    super(app);
    this.plugin = plugin;
    this.editor = editor;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Generate word cloud" });

    const separator = this.plugin.settings.separator || ",";
    const separatorName =
      separator === ","
        ? "comma"
        : separator === "."
        ? "period"
        : separator === " "
        ? "space"
        : `"${separator}"`;

    const inputContainer = contentEl.createDiv("word-cloud-modal-input");

    inputContainer.createEl("p", {
      text: `Enter words separated by ${separatorName}`,
      cls: "word-cloud-modal-helper",
    });

    const textarea = inputContainer.createEl("textarea", {
      cls: "word-cloud-modal-textarea",
    });
    textarea.placeholder = `Enter ${separatorName}-separated words...`;

    const buttonContainer = contentEl.createDiv("word-cloud-modal-buttons");

    const previewBtn = buttonContainer.createEl("button", {
      text: "Preview",
      cls: "word-cloud-modal-btn",
    });
    previewBtn.addEventListener("click", () => {
      const existing = contentEl.querySelector(
        ".word-cloud-preview"
      );
      if (existing instanceof HTMLElement) existing.remove();
      const preview = contentEl.createDiv("word-cloud-preview");
      this.plugin.renderWordCloud(textarea.value, preview);
    });

    const insertBtn = buttonContainer.createEl("button", {
      text: "Insert into note",
      cls: "word-cloud-modal-btn",
    });
    insertBtn.addEventListener("click", () => {
      if (this.editor) {
        const codeBlock = "```wordcloud\n" + textarea.value + "\n```\n";
        this.editor.replaceSelection(codeBlock);
        new Notice("Word cloud inserted!");
        this.close();
      } else {
        new Notice("No active editor found");
      }
    });

    const refreshBtn = buttonContainer.createEl("button", {
      text: "Refresh",
      cls: "word-cloud-modal-btn",
    });
    refreshBtn.addEventListener("click", () => {
      const previewContainer = contentEl.querySelector(
        ".word-cloud-preview"
      );
      if (previewContainer instanceof HTMLElement) {
        previewContainer.empty();
        this.plugin.renderWordCloud(textarea.value, previewContainer);
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class WordCloudSettingTab extends PluginSettingTab {
  plugin: WordCloudPlugin;

  constructor(app: App, plugin: WordCloudPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Separator setting
    new Setting(containerEl)
      .setName("Word separator")
      .setDesc("Character used to separate words in the cloud")
      .addDropdown((dropdown) =>
        dropdown
          .addOption(",", "Comma (,)")
          .addOption(".", "Period (.)")
          .addOption(" ", "Space ( )")
          .addOption(";", "Semicolon (;)")
          .addOption("|", "Pipe (|)")
          .setValue(this.plugin.settings.separator)
          .onChange(async (value) => {
            this.plugin.settings.separator = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Text casing")
      .setDesc("Transform word casing for consistent appearance")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("as-is", "As-is (keep original)")
          .addOption("uppercase", "Uppercase")
          .addOption("lowercase", "Lowercase")
          .addOption("title-case", "Title case")
          .setValue(this.plugin.settings.casing)
          .onChange(async (value) => {
            this.plugin.settings.casing = value as
              | "as-is"
              | "uppercase"
              | "lowercase"
              | "title-case";
            await this.plugin.saveSettings();
          })
      );

    // Font size heading
    new Setting(containerEl).setName("Font size").setHeading();

    new Setting(containerEl)
      .setName("Auto font size")
      .setDesc(
        "Automatically adjust font sizes based on word count (recommended)"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoFontSize)
          .onChange(async (value) => {
            this.plugin.settings.autoFontSize = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (!this.plugin.settings.autoFontSize) {
      new Setting(containerEl)
        .setName("Minimum font size")
        .setDesc("Minimum font size in pixels")
        .addText((text) =>
          text
            .setPlaceholder("12")
            .setValue(String(this.plugin.settings.minFontSize))
            .onChange(async (value) => {
              const num = parseInt(value);
              if (!isNaN(num) && num > 0) {
                this.plugin.settings.minFontSize = num;
                await this.plugin.saveSettings();
              }
            })
        );

      new Setting(containerEl)
        .setName("Maximum font size")
        .setDesc("Maximum font size in pixels")
        .addText((text) =>
          text
            .setPlaceholder("48")
            .setValue(String(this.plugin.settings.maxFontSize))
            .onChange(async (value) => {
              const num = parseInt(value);
              if (!isNaN(num) && num > 0) {
                this.plugin.settings.maxFontSize = num;
                await this.plugin.saveSettings();
              }
            })
        );
    } else {
      const autoInfo = containerEl.createDiv("word-cloud-info-box");
      autoInfo.createEl("div", {
        text: "Auto sizing rules (desktop):",
        cls: "word-cloud-info-title",
      });
      autoInfo.createEl("div", { text: "1–10 words: 20–56 px (big and bold)" });
      autoInfo.createEl("div", { text: "11–20 words: 16–40 px (balanced)" });
      autoInfo.createEl("div", { text: "21–40 words: 14–32 px (compact)" });
      autoInfo.createEl("div", { text: "41–70 words: 12–28 px (dense)" });
      autoInfo.createEl("div", { text: "70+ words: 10–22 px (very dense)" });
      autoInfo.createEl("div", {
        text: "On mobile, font sizes are reduced by ~40% to fit smaller screens.",
        cls: "word-cloud-info-note",
      });
    }

    // Spacing heading
    new Setting(containerEl).setName("Word spacing").setHeading();

    new Setting(containerEl)
      .setName("Auto spacing")
      .setDesc("Automatically adjust spacing based on word count (recommended)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSpacing)
          .onChange(async (value) => {
            this.plugin.settings.autoSpacing = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (!this.plugin.settings.autoSpacing) {
      new Setting(containerEl)
        .setName("Spacing preset")
        .setDesc(
          "Space between words. Change this and refresh your word cloud to see the difference."
        )
        .addDropdown((dropdown) =>
          dropdown
            .addOption("compact", "Compact – very tight")
            .addOption("normal", "Normal – balanced")
            .addOption("comfortable", "Comfortable – loose")
            .addOption("loose", "Loose – very loose")
            .setValue(this.plugin.settings.spacing)
            .onChange(async (value) => {
              this.plugin.settings.spacing = value as
                | "compact"
                | "normal"
                | "comfortable"
                | "loose";
              await this.plugin.saveSettings();
            })
        );
    } else {
      const autoInfo = containerEl.createDiv("word-cloud-info-box");
      autoInfo.createEl("div", {
        text: "Auto spacing rules (desktop):",
        cls: "word-cloud-info-title",
      });
      autoInfo.createEl("div", {
        text: "1–10 words: loose (spread out nicely)",
      });
      autoInfo.createEl("div", { text: "11–20 words: comfortable" });
      autoInfo.createEl("div", { text: "21–40 words: normal" });
      autoInfo.createEl("div", { text: "40+ words: compact (fit everything)" });
      autoInfo.createEl("div", {
        text: "On mobile, spacing is automatically tighter to maximise word visibility.",
        cls: "word-cloud-info-note",
      });
    }

    // Color palette heading
    new Setting(containerEl).setName("Color palette").setHeading();

    containerEl.createEl("p", {
      text: "Colors used for words in the cloud. Click a color to change it, or add and remove colors.",
      cls: "word-cloud-palette-desc",
    });

    const colorContainer = containerEl.createDiv("word-cloud-palette");

    const renderColorPalette = () => {
      colorContainer.empty();

      this.plugin.settings.colorPalette.forEach((color, index) => {
        const colorItem = colorContainer.createDiv("word-cloud-palette-item");

        const colorInput = colorItem.createEl("input", {
          cls: "word-cloud-palette-swatch",
        });
        colorInput.type = "color";
        colorInput.value = color;

        colorInput.addEventListener("change", (e) => {
          const target = e.target as HTMLInputElement;
          this.plugin.settings.colorPalette[index] = target.value;
          void this.plugin.saveSettings();
        });

        const colorLabel = colorItem.createEl("span", {
          cls: "word-cloud-palette-label",
        });
        colorLabel.textContent = color.toUpperCase();

        const removeBtn = colorItem.createEl("button", {
          cls: "word-cloud-palette-remove",
        });
        removeBtn.textContent = "×";
        removeBtn.setAttribute("aria-label", "Remove color");

        removeBtn.addEventListener("click", () => {
          if (this.plugin.settings.colorPalette.length > 1) {
            this.plugin.settings.colorPalette.splice(index, 1);
            void this.plugin.saveSettings();
            renderColorPalette();
          } else {
            new Notice("You must have at least one color in the palette");
          }
        });

        if (this.plugin.settings.colorPalette.length === 1) {
          removeBtn.disabled = true;
          removeBtn.addClass("word-cloud-palette-remove--disabled");
        }
      });

      const addColorBtn = colorContainer.createEl("button", {
        text: "Add color",
        cls: "word-cloud-palette-add",
      });

      addColorBtn.addEventListener("click", () => {
        const randomColor =
          "#" +
          Math.floor(Math.random() * 16777215)
            .toString(16)
            .padStart(6, "0");
        this.plugin.settings.colorPalette.push(randomColor);
        void this.plugin.saveSettings();
        renderColorPalette();
      });
    };

    renderColorPalette();

    new Setting(containerEl)
      .setName("Reset color palette")
      .setDesc("Reset colors to the default palette")
      .addButton((button) =>
        button.setButtonText("Reset to defaults").onClick(async () => {
          this.plugin.settings.colorPalette = [
            ...DEFAULT_SETTINGS.colorPalette,
          ];
          await this.plugin.saveSettings();
          renderColorPalette();
          new Notice("Color palette reset to defaults");
        })
      );
  }
}
