import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface WordCloudSettings {
    minFontSize: number;
    maxFontSize: number;
    colorPalette: string[];
    separator: string;
    spacing: 'compact' | 'normal' | 'comfortable' | 'loose';
    autoFontSize: boolean;
    autoSpacing: boolean;
    casing: 'as-is' | 'uppercase' | 'lowercase' | 'title-case';
}

const DEFAULT_SETTINGS: WordCloudSettings = {
    minFontSize: 12,
    maxFontSize: 48,
    colorPalette: ['#0066cc', '#cc6600', '#cc0066', '#6600cc', '#00cc66'],
    separator: ',',
    spacing: 'normal',
    autoFontSize: true,
    autoSpacing: true,
    casing: 'as-is'
}

// Spacing configurations
const SPACING_CONFIG = {
    'compact': { padding: 3, margin: 5, startRadius: 1, spiralStep: 1.5 },
    'normal': { padding: 12, margin: 12, startRadius: 5, spiralStep: 4 },
    'comfortable': { padding: 22, margin: 18, startRadius: 12, spiralStep: 7 },
    'loose': { padding: 35, margin: 25, startRadius: 20, spiralStep: 10 }
};

// Auto-calculated spacing based on word count and screen size
function getAutoSpacing(wordCount: number, isMobile: boolean = false): typeof SPACING_CONFIG['normal'] {
    // Mobile gets tighter spacing to fit more words
    if (isMobile) {
        if (wordCount <= 10) {
            return SPACING_CONFIG['comfortable'];
        } else if (wordCount <= 20) {
            return SPACING_CONFIG['normal'];
        } else {
            return SPACING_CONFIG['compact'];
        }
    }
    
    // Desktop spacing
    if (wordCount <= 10) {
        return SPACING_CONFIG['loose'];
    } else if (wordCount <= 20) {
        return SPACING_CONFIG['comfortable'];
    } else if (wordCount <= 40) {
        return SPACING_CONFIG['normal'];
    } else {
        return SPACING_CONFIG['compact'];
    }
}

// Apply casing transformation to text
function applyCasing(text: string, casing: 'as-is' | 'uppercase' | 'lowercase' | 'title-case'): string {
    switch (casing) {
        case 'uppercase':
            return text.toUpperCase();
        case 'lowercase':
            return text.toLowerCase();
        case 'title-case':
            // For word clouds, simply capitalize first letter of each word
            // If it's a phrase, apply smart title case rules
            const words = text.toLowerCase().split(' ');
            if (words.length === 1) {
                // Single word - just capitalize first letter
                return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
            } else {
                // Multi-word phrase - use smart title case
                const smallWords = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with'];
                return words.map((word, index) => {
                    // Always capitalize first and last word, or if not a small word
                    if (index === 0 || index === words.length - 1 || !smallWords.includes(word)) {
                        return word.charAt(0).toUpperCase() + word.slice(1);
                    }
                    return word;
                }).join(' ');
            }
        case 'as-is':
        default:
            return text;
    }
}

// Auto-calculated font sizes based on word count and screen size
function getAutoFontSizes(wordCount: number, isMobile: boolean = false): { min: number; max: number } {
    // Mobile gets smaller fonts due to limited screen space (typically 360-430px width)
    if (isMobile) {
        if (wordCount <= 10) {
            return { min: 14, max: 32 };
        } else if (wordCount <= 20) {
            return { min: 12, max: 26 };
        } else if (wordCount <= 40) {
            return { min: 10, max: 20 };
        } else if (wordCount <= 70) {
            return { min: 9, max: 16 };
        } else {
            return { min: 8, max: 14 };
        }
    }
    
    // Desktop font sizes (typically 700+ px width)
    if (wordCount <= 10) {
        return { min: 20, max: 56 };
    } else if (wordCount <= 20) {
        return { min: 16, max: 40 }; // Better for 11-20 words
    } else if (wordCount <= 40) {
        return { min: 14, max: 32 }; // Better for 21-40 words
    } else if (wordCount <= 70) {
        return { min: 12, max: 28 }; // For larger clouds
    } else {
        return { min: 10, max: 22 }; // Dense clouds
    }
}

export default class WordCloudPlugin extends Plugin {
    settings: WordCloudSettings;

    async onload() {
        await this.loadSettings();

        // Add ribbon icon
        this.addRibbonIcon('cloud', 'Generate Word Cloud', (evt: MouseEvent) => {
            new WordCloudModal(this.app, this).open();
        });

        // Add command
        this.addCommand({
            id: 'insert-word-cloud',
            name: 'Insert Word Cloud',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                new WordCloudModal(this.app, this, editor).open();
            }
        });

        // Register markdown code block processor
        this.registerMarkdownCodeBlockProcessor('wordcloud', (source, el, ctx) => {
            this.renderWordCloud(source, el);
        });

        // Add settings tab
        this.addSettingTab(new WordCloudSettingTab(this.app, this));
    }

    renderWordCloud(source: string, container: HTMLElement) {
        container.empty();
        container.addClass('word-cloud-container');

        // Use the configured separator
        const separator = this.settings.separator || ',';
        const rawWords = source.split(separator).map(w => w.trim()).filter(w => w.length > 0);
        
        // Apply casing transformation
        const words = rawWords.map(word => applyCasing(word, this.settings.casing));
        
        if (words.length === 0) {
            container.createEl('p', { text: `No words provided. Add ${separator}-separated words.` });
            return;
        }

        const colors = this.settings.colorPalette.length > 0 
            ? this.settings.colorPalette 
            : DEFAULT_SETTINGS.colorPalette;

        // Mobile-responsive width detection
        const getContainerWidth = () => {
            if (container.offsetWidth > 0) {
                return container.offsetWidth;
            }
            // Fallback for mobile - account for padding
            if (typeof window !== 'undefined') {
                return Math.min(window.innerWidth - 40, 700);
            }
            return 700;
        };

        const containerWidth = getContainerWidth();
        // Detect mobile based on container width
        const isMobile = containerWidth < 500;
        
        // Get font sizes - either auto or manual
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

        // Get spacing configuration - either auto or manual
        let spacingConfig: typeof SPACING_CONFIG['normal'];
        if (this.settings.autoSpacing) {
            spacingConfig = getAutoSpacing(words.length, isMobile);
        } else {
            const currentSpacing = this.settings.spacing || 'normal';
            spacingConfig = SPACING_CONFIG[currentSpacing];
        }

        // Responsive height - smaller on mobile
        const containerHeight = isMobile ? 400 : 500;
        container.style.height = containerHeight + 'px';
        container.style.position = 'relative';

        // Function to render the cloud with optional centered word
        const renderWords = (centeredWord: string | null = null) => {
            // Clear container first
            container.empty();
            
            let shuffledWords: string[];
            if (centeredWord) {
                // Put centered word first, shuffle the rest
                const otherWords = words.filter(w => w !== centeredWord);
                shuffledWords = [centeredWord, ...otherWords.sort(() => Math.random() - 0.5)];
            } else {
                shuffledWords = [...words].sort(() => Math.random() - 0.5);
            }

            const placedElements: Array<{
                centerX: number,
                centerY: number,
                width: number,
                height: number,
                rotation: number
            }> = [];

            // Helper function to check if two rotated rectangles overlap
            const checkOverlap = (rect1: any, rect2: any): boolean => {
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
                
                const left1 = rect1.centerX - w1/2 - padding;
                const right1 = rect1.centerX + w1/2 + padding;
                const top1 = rect1.centerY - h1/2 - padding;
                const bottom1 = rect1.centerY + h1/2 + padding;
                
                const left2 = rect2.centerX - w2/2 - padding;
                const right2 = rect2.centerX + w2/2 + padding;
                const top2 = rect2.centerY - h2/2 - padding;
                const bottom2 = rect2.centerY + h2/2 + padding;
                
                return !(right1 < left2 || left1 > right2 || bottom1 < top2 || top1 > bottom2);
            };

            // Pre-generate all word data with measurements
            const tempElements: Array<{
                width: number,
                height: number,
                fontSize: number,
                color: string,
                rotation: number,
                word: string,
                isCentered: boolean
            }> = [];

            // Create off-screen measurement container
            const canvas = document.createElement('canvas');
            let ctx: CanvasRenderingContext2D | null = null;
            
            try {
                ctx = canvas.getContext('2d');
            } catch (error) {
                console.error('Canvas context error:', error);
            }
            
            if (!ctx) {
                console.error('Could not get canvas context');
                // Fallback: use approximate measurements
                shuffledWords.forEach((word) => {
                    const isCentered = centeredWord === word;
                    const fontSize = isCentered 
                        ? Math.floor((maxFontSize + minFontSize) / 2 + 10)
                        : Math.floor(Math.random() * (maxFontSize - minFontSize + 1)) + minFontSize;

                    const color = colors[Math.floor(Math.random() * colors.length)];
                    const rotations = isCentered ? [0] : [0, 0, 0, 0, 90, -90];
                    const rotation = rotations[Math.floor(Math.random() * rotations.length)];

                    // Approximate measurements without canvas
                    const width = Math.ceil(word.length * fontSize * 0.6) + 8;
                    const height = fontSize + 8;

                    tempElements.push({
                        width: width,
                        height: height,
                        fontSize: fontSize,
                        color: color,
                        rotation: rotation,
                        word: word,
                        isCentered: isCentered
                    });
                });
                
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        positionWords();
                    }, 50);
                });
                return;
            }

            shuffledWords.forEach((word) => {
                const isCentered = centeredWord === word;
                const fontSize = isCentered 
                    ? Math.floor((maxFontSize + minFontSize) / 2 + 10)
                    : Math.floor(Math.random() * (maxFontSize - minFontSize + 1)) + minFontSize;

                const color = colors[Math.floor(Math.random() * colors.length)];
                const rotations = isCentered ? [0] : [0, 0, 0, 0, 90, -90];
                const rotation = rotations[Math.floor(Math.random() * rotations.length)];

                // Measure using canvas for accurate text metrics
                const fontFamily = container.isConnected 
                    ? (getComputedStyle(container).fontFamily || 'Arial, sans-serif')
                    : 'Arial, sans-serif';
                // ctx is guaranteed to be non-null here because we returned early if it was null
                ctx!.font = `bold ${fontSize}px ${fontFamily}`;
                const metrics = ctx!.measureText(word);
                const width = Math.ceil(metrics.width) + 8;
                const height = fontSize + 8;

                tempElements.push({
                    width: width,
                    height: height,
                    fontSize: fontSize,
                    color: color,
                    rotation: rotation,
                    word: word,
                    isCentered: isCentered
                });
            });
            
            // Wait for container to be ready
            requestAnimationFrame(() => {
                setTimeout(() => {
                    positionWords();
                }, 50);
            });
            
            const positionWords = () => {
                // Sort by size unless there's a centered word (which goes first)
                if (!centeredWord) {
                    tempElements.sort((a, b) => (b.width * b.height) - (a.width * a.height));
                }

                const centerX = containerWidth / 2;
                const centerY = containerHeight / 2;

                tempElements.forEach((temp) => {
                    const tag = container.createEl('span');
                    tag.addClass('word-cloud-word');
                    tag.textContent = temp.word;
                    tag.style.fontSize = temp.fontSize + 'px';
                    tag.style.color = temp.color;
                    tag.style.position = 'absolute';
                    tag.style.whiteSpace = 'nowrap';
                    tag.style.fontWeight = 'bold';
                    tag.style.cursor = 'pointer';
                    tag.style.transition = 'all 0.5s ease';
                    tag.style.userSelect = 'none';
                    tag.style.setProperty('-webkit-tap-highlight-color', 'transparent'); // Remove tap highlight on mobile
                    tag.style.touchAction = 'manipulation'; // Improve touch responsiveness
                    // Prevent flickering during transforms
                    tag.style.willChange = 'transform';
                    tag.style.backfaceVisibility = 'hidden';
                    tag.style.setProperty('-webkit-font-smoothing', 'antialiased');
                    tag.style.setProperty('-moz-osx-font-smoothing', 'grayscale');

                    const tagWidth = temp.width;
                    const tagHeight = temp.height;
                    const rotation = temp.rotation;
                    const isCentered = temp.isCentered;

                    let placed = false;

                    // If this is the centered word, place it at the center
                    if (isCentered) {
                        const x = centerX - tagWidth / 2;
                        const y = centerY - tagHeight / 2;
                        
                        tag.style.left = x + 'px';
                        tag.style.top = y + 'px';
                        tag.style.transform = `rotate(${rotation}deg) scale(1.2)`;
                        tag.style.transformOrigin = 'center center';
                        tag.style.fontWeight = '900';
                        tag.style.zIndex = '50';
                        
                        placedElements.push({
                            centerX: centerX,
                            centerY: centerY,
                            width: tagWidth * 1.5,
                            height: tagHeight * 1.5,
                            rotation: rotation
                        });
                        placed = true;
                    } else {
                        // Spiral placement algorithm with configurable spacing
                        let spiralRadius = 120; // Always start from same distance when there's a centered word
                        const spiralStep = spacingConfig.spiralStep;
                        const angleStep = 0.08;
                        let angle = Math.random() * Math.PI * 2;

                        const maxRadius = Math.max(containerWidth, containerHeight) * 2;
                        const maxAttempts = 20000;
                        let attempts = 0;

                        while (!placed && spiralRadius < maxRadius && attempts < maxAttempts) {
                            const testCenterX = centerX + spiralRadius * Math.cos(angle);
                            const testCenterY = centerY + spiralRadius * Math.sin(angle);

                            // Calculate needed space based on rotation
                            let neededWidth = tagWidth;
                            let neededHeight = tagHeight;
                            if (Math.abs(rotation) === 90) {
                                [neededWidth, neededHeight] = [neededHeight, neededWidth];
                            }

                            const left = testCenterX - neededWidth / 2;
                            const right = testCenterX + neededWidth / 2;
                            const top = testCenterY - neededHeight / 2;
                            const bottom = testCenterY + neededHeight / 2;

                            // Check if within boundaries with configurable margin
                            const margin = spacingConfig.margin;
                            if (left >= margin && right <= containerWidth - margin && 
                                top >= margin && bottom <= containerHeight - margin) {
                                
                                const testRect = {
                                    centerX: testCenterX,
                                    centerY: testCenterY,
                                    width: tagWidth,
                                    height: tagHeight,
                                    rotation: rotation
                                };

                                // Check collision with all placed elements
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
                                    
                                    tag.style.left = x + 'px';
                                    tag.style.top = y + 'px';
                                    tag.style.transform = `rotate(${rotation}deg)`;
                                    tag.style.transformOrigin = 'center center';
                                    
                                    placedElements.push(testRect);
                                    placed = true;
                                }
                            }

                            // Advance spiral
                            angle += angleStep;
                            spiralRadius += spiralStep * (angleStep / (2 * Math.PI));
                            attempts++;
                        }

                        // If couldn't place after all attempts, don't show the word
                        if (!placed) {
                            tag.remove();
                        }
                    }

                    if (placed) {
                        // Store rotation for event handlers
                        tag.dataset.rotation = String(rotation);
                        tag.dataset.isCentered = String(isCentered);
                        
                        // Click handler to center this word
                        tag.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            renderWords(temp.word);
                        });

                        // Touch handler for mobile (prevents 300ms delay)
                        tag.addEventListener('touchend', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            renderWords(temp.word);
                        });

                        // Hover effects (desktop)
                        tag.addEventListener('mouseenter', () => {
                            if (!isCentered) {
                                const rot = parseInt(tag.dataset.rotation || '0');
                                tag.style.transform = `rotate(${rot}deg) scale(1.1)`;
                                tag.style.zIndex = '100';
                            }
                        });

                        tag.addEventListener('mouseleave', () => {
                            if (!isCentered) {
                                const rot = parseInt(tag.dataset.rotation || '0');
                                tag.style.transform = `rotate(${rot}deg) scale(1)`;
                                tag.style.zIndex = '1';
                            }
                        });

                        // Touch feedback for mobile with timeout
                        let touchScaleTimeout: number;
                        tag.addEventListener('touchstart', (e) => {
                            if (!isCentered) {
                                // Visual feedback on touch
                                const rot = parseInt(tag.dataset.rotation || '0');
                                tag.style.transform = `rotate(${rot}deg) scale(1.1)`;
                                tag.style.zIndex = '100';
                                
                                // Clear any existing timeout
                                if (touchScaleTimeout) {
                                    window.clearTimeout(touchScaleTimeout);
                                }
                            }
                        });

                        tag.addEventListener('touchcancel', () => {
                            if (!isCentered) {
                                // Reset on touch cancel with slight delay
                                touchScaleTimeout = window.setTimeout(() => {
                                    const rot = parseInt(tag.dataset.rotation || '0');
                                    tag.style.transform = `rotate(${rot}deg) scale(1)`;
                                    tag.style.zIndex = '1';
                                }, 100);
                            }
                        });
                    }
                });
            };
        };

        // Initial render: Pick a random word to center
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

        contentEl.createEl('h2', { text: 'Generate Word Cloud' });

        const separator = this.plugin.settings.separator || ',';
        const separatorName = separator === ',' ? 'comma' : separator === '.' ? 'period' : separator === ' ' ? 'space' : `"${separator}"`;

        const inputContainer = contentEl.createDiv();
        inputContainer.style.marginBottom = '20px';

        const helperText = inputContainer.createEl('p', { 
            text: `Enter words separated by ${separatorName}` 
        });
        helperText.style.fontSize = '0.9em';
        helperText.style.color = 'var(--text-muted)';
        helperText.style.marginBottom = '8px';

        const textarea = inputContainer.createEl('textarea');
        textarea.placeholder = `Enter ${separatorName}-separated words...`;
        textarea.value = '';
        textarea.style.width = '100%';
        textarea.style.minHeight = '100px';
        textarea.style.padding = '10px';
        textarea.style.marginBottom = '10px';
        textarea.style.fontSize = '16px'; // Prevents zoom on iOS
        textarea.style.boxSizing = 'border-box';

        const buttonContainer = contentEl.createDiv();
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.flexWrap = 'wrap'; // Allow wrapping on small screens

        const previewBtn = buttonContainer.createEl('button', { text: 'Preview' });
        previewBtn.style.flex = '1'; // Allow buttons to grow on mobile
        previewBtn.style.minWidth = '80px';
        previewBtn.addEventListener('click', () => {
            const previewContainer = contentEl.querySelector('.preview-container') as HTMLElement;
            if (previewContainer) {
                previewContainer.remove();
            }
            const preview = contentEl.createDiv('preview-container');
            preview.style.marginTop = '20px';
            preview.style.border = '1px solid var(--background-modifier-border)';
            preview.style.borderRadius = '8px';
            preview.style.padding = '20px';
            this.plugin.renderWordCloud(textarea.value, preview);
        });

        const insertBtn = buttonContainer.createEl('button', { text: 'Insert into Note' });
        insertBtn.style.flex = '1';
        insertBtn.style.minWidth = '80px';
        insertBtn.addEventListener('click', () => {
            if (this.editor) {
                const codeBlock = '```wordcloud\n' + textarea.value + '\n```\n';
                this.editor.replaceSelection(codeBlock);
                new Notice('Word cloud inserted!');
                this.close();
            } else {
                new Notice('No active editor found');
            }
        });

        const refreshBtn = buttonContainer.createEl('button', { text: 'Refresh' });
        refreshBtn.style.flex = '1';
        refreshBtn.style.minWidth = '80px';
        refreshBtn.addEventListener('click', () => {
            const previewContainer = contentEl.querySelector('.preview-container') as HTMLElement;
            if (previewContainer) {
                previewContainer.empty();
                this.plugin.renderWordCloud(textarea.value, previewContainer);
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
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

        containerEl.createEl('h2', { text: 'Word Cloud Settings' });

        // Separator setting
        new Setting(containerEl)
            .setName('Word separator')
            .setDesc('Character used to separate words in the cloud')
            .addDropdown(dropdown => dropdown
                .addOption(',', 'Comma (,)')
                .addOption('.', 'Period (.)')
                .addOption(' ', 'Space ( )')
                .addOption(';', 'Semicolon (;)')
                .addOption('|', 'Pipe (|)')
                .setValue(this.plugin.settings.separator)
                .onChange(async (value) => {
                    this.plugin.settings.separator = value;
                    await this.plugin.saveSettings();
                }));

        // Text casing setting
        new Setting(containerEl)
            .setName('Text casing')
            .setDesc('Transform word casing for consistent appearance')
            .addDropdown(dropdown => dropdown
                .addOption('as-is', 'As-is (keep original)')
                .addOption('uppercase', 'UPPERCASE')
                .addOption('lowercase', 'lowercase')
                .addOption('title-case', 'Title Case')
                .setValue(this.plugin.settings.casing)
                .onChange(async (value) => {
                    this.plugin.settings.casing = value as 'as-is' | 'uppercase' | 'lowercase' | 'title-case';
                    await this.plugin.saveSettings();
                }));

        // Font size section header
        containerEl.createEl('h3', { text: 'Font Size' });

        // Auto font size toggle
        new Setting(containerEl)
            .setName('Auto font size')
            .setDesc('Automatically adjust font sizes based on word count (recommended)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoFontSize)
                .onChange(async (value) => {
                    this.plugin.settings.autoFontSize = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show/hide manual settings
                }));

        // Manual font size settings (only show when auto is off)
        if (!this.plugin.settings.autoFontSize) {
            new Setting(containerEl)
                .setName('Minimum font size')
                .setDesc('Minimum font size in pixels')
                .addText(text => text
                    .setPlaceholder('12')
                    .setValue(String(this.plugin.settings.minFontSize))
                    .onChange(async (value) => {
                        const num = parseInt(value);
                        if (!isNaN(num) && num > 0) {
                            this.plugin.settings.minFontSize = num;
                            await this.plugin.saveSettings();
                        }
                    }));

            new Setting(containerEl)
                .setName('Maximum font size')
                .setDesc('Maximum font size in pixels')
                .addText(text => text
                    .setPlaceholder('48')
                    .setValue(String(this.plugin.settings.maxFontSize))
                    .onChange(async (value) => {
                        const num = parseInt(value);
                        if (!isNaN(num) && num > 0) {
                            this.plugin.settings.maxFontSize = num;
                            await this.plugin.saveSettings();
                        }
                    }));
        } else {
            // Show info about auto sizing
            const autoInfo = containerEl.createEl('div');
            autoInfo.style.padding = '10px';
            autoInfo.style.marginBottom = '15px';
            autoInfo.style.backgroundColor = 'var(--background-secondary)';
            autoInfo.style.borderRadius = '4px';
            autoInfo.style.fontSize = '0.9em';
            autoInfo.style.lineHeight = '1.6';
            
            autoInfo.createEl('div', { text: '📐 Auto sizing rules (Desktop):' }).style.fontWeight = 'bold';
            autoInfo.createEl('div', { text: '• 1-10 words: 20-56px (big & bold)' });
            autoInfo.createEl('div', { text: '• 11-20 words: 16-40px (balanced)' });
            autoInfo.createEl('div', { text: '• 21-40 words: 14-32px (compact)' });
            autoInfo.createEl('div', { text: '• 41-70 words: 12-28px (dense)' });
            autoInfo.createEl('div', { text: '• 70+ words: 10-22px (very dense)' });
            autoInfo.createEl('div', { text: '' }); // Spacer
            autoInfo.createEl('div', { text: '📱 On mobile, font sizes are automatically reduced by ~40% to fit more words on smaller screens.' }).style.fontStyle = 'italic';
        }

        // Spacing section header
        containerEl.createEl('h3', { text: 'Word Spacing' });

        // Auto spacing toggle
        new Setting(containerEl)
            .setName('Auto spacing')
            .setDesc('Automatically adjust spacing based on word count (recommended)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSpacing)
                .onChange(async (value) => {
                    this.plugin.settings.autoSpacing = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show/hide manual settings
                }));

        // Manual spacing setting (only show when auto is off)
        if (!this.plugin.settings.autoSpacing) {
            new Setting(containerEl)
                .setName('Spacing preset')
                .setDesc('Space between words. Change this and refresh your word cloud to see the difference.')
                .addDropdown(dropdown => dropdown
                    .addOption('compact', 'Compact - Very tight')
                    .addOption('normal', 'Normal - Balanced')
                    .addOption('comfortable', 'Comfortable - Loose')
                    .addOption('loose', 'Loose - Very loose')
                    .setValue(this.plugin.settings.spacing)
                    .onChange(async (value) => {
                        this.plugin.settings.spacing = value as 'compact' | 'normal' | 'comfortable' | 'loose';
                        await this.plugin.saveSettings();
                    }));
        } else {
            // Show info about auto spacing
            const autoInfo = containerEl.createEl('div');
            autoInfo.style.padding = '10px';
            autoInfo.style.marginBottom = '15px';
            autoInfo.style.backgroundColor = 'var(--background-secondary)';
            autoInfo.style.borderRadius = '4px';
            autoInfo.style.fontSize = '0.9em';
            autoInfo.style.lineHeight = '1.6';
            
            autoInfo.createEl('div', { text: '📏 Auto spacing rules (Desktop):' }).style.fontWeight = 'bold';
            autoInfo.createEl('div', { text: '• 1-10 words: Loose (spread out nicely)' });
            autoInfo.createEl('div', { text: '• 11-20 words: Comfortable' });
            autoInfo.createEl('div', { text: '• 21-40 words: Normal' });
            autoInfo.createEl('div', { text: '• 40+ words: Compact (fit everything)' });
            autoInfo.createEl('div', { text: '' }); // Spacer
            autoInfo.createEl('div', { text: '📱 On mobile, spacing is automatically tighter to maximize word visibility.' }).style.fontStyle = 'italic';
        }

        // Color palette section
        containerEl.createEl('h3', { text: 'Color Palette' });
        
        const colorDesc = containerEl.createEl('p', { 
            text: 'Colors used for words in the cloud. Click on a color to change it, or add/remove colors.' 
        });
        colorDesc.style.fontSize = '0.9em';
        colorDesc.style.color = 'var(--text-muted)';
        colorDesc.style.marginBottom = '10px';

        const colorContainer = containerEl.createDiv();
        colorContainer.style.display = 'flex';
        colorContainer.style.flexWrap = 'wrap';
        colorContainer.style.gap = '10px';
        colorContainer.style.marginBottom = '15px';

        const renderColorPalette = () => {
            colorContainer.empty();
            
            this.plugin.settings.colorPalette.forEach((color, index) => {
                const colorItem = colorContainer.createDiv();
                colorItem.style.display = 'flex';
                colorItem.style.alignItems = 'center';
                colorItem.style.gap = '8px';
                colorItem.style.padding = '5px';
                colorItem.style.border = '1px solid var(--background-modifier-border)';
                colorItem.style.borderRadius = '4px';

                const colorInput = colorItem.createEl('input');
                colorInput.type = 'color';
                colorInput.value = color;
                colorInput.style.width = '50px';
                colorInput.style.height = '30px';
                colorInput.style.border = 'none';
                colorInput.style.cursor = 'pointer';
                
                colorInput.addEventListener('change', async (e) => {
                    const target = e.target as HTMLInputElement;
                    this.plugin.settings.colorPalette[index] = target.value;
                    await this.plugin.saveSettings();
                });

                const colorLabel = colorItem.createEl('span');
                colorLabel.textContent = color.toUpperCase();
                colorLabel.style.fontSize = '0.9em';
                colorLabel.style.fontFamily = 'monospace';
                colorLabel.style.minWidth = '70px';

                const removeBtn = colorItem.createEl('button');
                removeBtn.textContent = '×';
                removeBtn.style.padding = '2px 8px';
                removeBtn.style.marginLeft = '5px';
                removeBtn.style.cursor = 'pointer';
                removeBtn.setAttribute('aria-label', 'Remove color');
                
                removeBtn.addEventListener('click', async () => {
                    if (this.plugin.settings.colorPalette.length > 1) {
                        this.plugin.settings.colorPalette.splice(index, 1);
                        await this.plugin.saveSettings();
                        renderColorPalette();
                    } else {
                        new Notice('You must have at least one color in the palette');
                    }
                });

                if (this.plugin.settings.colorPalette.length === 1) {
                    removeBtn.disabled = true;
                    removeBtn.style.opacity = '0.3';
                }
            });

            // Add new color button
            const addColorBtn = colorContainer.createEl('button');
            addColorBtn.textContent = '+ Add Color';
            addColorBtn.style.padding = '5px 15px';
            addColorBtn.style.cursor = 'pointer';
            
            addColorBtn.addEventListener('click', async () => {
                // Generate a random color
                const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
                this.plugin.settings.colorPalette.push(randomColor);
                await this.plugin.saveSettings();
                renderColorPalette();
            });
        };

        renderColorPalette();

        // Reset to defaults button
        new Setting(containerEl)
            .setName('Reset color palette')
            .setDesc('Reset colors to default palette')
            .addButton(button => button
                .setButtonText('Reset to Defaults')
                .onClick(async () => {
                    this.plugin.settings.colorPalette = [...DEFAULT_SETTINGS.colorPalette];
                    await this.plugin.saveSettings();
                    renderColorPalette();
                    new Notice('Color palette reset to defaults');
                }));
    }
}
