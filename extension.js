import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ScreenshotUI } from 'resource:///org/gnome/shell/ui/screenshot.js';

export default class OcrScreenshotExtension extends Extension {
    enable() {
        this._signalId = 0;
        this._ocrCancellable = null;
        this._openOverride = false;
        this._originalOpen = null;

        if (Main.screenshotUI) {
            this._patchScreenshotUI(Main.screenshotUI);
        } 
        
        this._originalOpen = ScreenshotUI.prototype.open;
        let self = this;
        this._myOpenWrapper = async function(...args) {
            let result = await self._originalOpen.call(this, ...args);
            self._patchScreenshotUI(this);
            return result;
        };

        ScreenshotUI.prototype.open = this._myOpenWrapper;
        this._openOverride = true;
    }

    _patchScreenshotUI(ui) {
        // 1. Signal triggered when a screenshot is taken
        if (!this._signalId) {
            console.debug(`[${this.metadata.uuid}] Connecting to screenshot-taken signal`);
            this._signalId = ui.connect('screenshot-taken', (_ui, file) => {
                let isOcrCapture = ui._isOcrCapture; // Custom mode flag
                ui._isOcrCapture = false; // Reset to default

                if (file && isOcrCapture) {
                    // Process the screenshot file and delete it afterwards
                    this._runTesseract(file.get_path(), true);
                }
            });
        }

        // 2. Create and position the button only once
        if (!ui._ocrButton) {
            ui._ocrButton = new St.Button({
                style_class: 'screenshot-ui-shot-cast-button', 
                icon_name: 'edit-select-text-symbolic',
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
                toggle_mode: true,
            });

            // Simulate OCR as a third option by managing active states
            ui._ocrButton.connect('notify::checked', () => {
                if (ui._ocrButton.checked) {
                    ui._isOcrModeActive = true;
                    // Visually disable the default shot button while keeping it functional for GNOME
                    if (ui._shotButton) {
                        ui._shotButton.toggle_mode = true;
                        ui._shotButton.remove_style_pseudo_class('checked');
                    }
                    if (ui._castButton) {
                        ui._castButton.toggle_mode = true;
                        ui._castButton.checked = false;
                    }
                } else {
                    // Revert to Photo mode if turned off
                    ui._isOcrModeActive = false;
                    if (ui._shotButton) {
                        ui._shotButton.checked = true;
                        ui._shotButton.add_style_pseudo_class('checked');
                    }
                }
            });

            // Disable OCR mode when Camera or Video modes are explicitly selected
            if (ui._shotButton) {
                ui._shotButton.connect('notify::checked', () => {
                   if (ui._shotButton.checked) {
                       ui._ocrButton.checked = false;
                       ui._isOcrModeActive = false;
                       ui._shotButton.add_style_pseudo_class('checked');
                   }
                });
            }
            if (ui._castButton) {
                ui._castButton.connect('notify::checked', () => {
                   if (ui._castButton.checked) {
                       ui._ocrButton.checked = false;
                       ui._isOcrModeActive = false;
                   }
                });
            }

            // Add the OCR button to the toggle container
            if (ui._shotCastContainer) {
                ui._shotCastContainer.add_child(ui._ocrButton);
            } else if (ui._captureButton) {
                let container = ui._captureButton.get_parent();
                if (container) {
                    container.add_child(ui._ocrButton);
                }
            } else {
                console.warn(`[${this.metadata.uuid}] ui._captureButton not found!`);
            }

            // Override the main capture button click to intercept OCR requests
            if (!ui._ocrCaptureConnected && ui._captureButton) {
                ui._originalCaptureClicked = ui._onCaptureButtonClicked;
                ui._onCaptureButtonClicked = async function() {
                    let isSelectionMode = ui._selectionButton && ui._selectionButton.checked;
                    if (ui._isOcrModeActive && isSelectionMode) {
                        ui._isOcrCapture = true; 
                        // Trick GNOME into allowing the capture
                        ui._shotButton.checked = true;
                    } else {
                        ui._isOcrCapture = false;
                    }
                    return await ui._originalCaptureClicked.call(this);
                };
                ui._ocrCaptureConnected = true;
            }

            // Restrict visibility strictly to the Area Selection panel
            let updateVisibility = () => {
                if (ui._selectionButton) {
                    let isSelection = ui._selectionButton.checked;
                    ui._ocrButton.visible = isSelection;
                    
                    if (!isSelection) {
                        ui._isOcrModeActive = false;
                        ui._ocrButton.checked = false;
                        if (ui._shotButton) {
                            ui._shotButton.checked = true;
                            ui._shotButton.add_style_pseudo_class('checked');
                        }
                    }
                }
            };

            if (ui._selectionButton) {
                ui._selectionButton.connect('notify::checked', updateVisibility);
                updateVisibility();
            } else {
                 console.warn(`[${this.metadata.uuid}] ui._selectionButton not found!`);
            }
        }
    }

    _getInstalledLangs() {
        let settings = this.getSettings();
        let userVal = settings.get_user_value('languages');
        
        if (userVal !== null) {
            return settings.get_string('languages');
        }

        // Fallback options if no settings saved yet:
        try {
            let [ok, stdout, stderr] = GLib.spawn_command_line_sync('tesseract --list-langs');
            if (ok && stdout) {
                let output = new TextDecoder().decode(stdout);
                let lines = output.split('\n');
                let langs = lines.slice(1)
                                 .map(l => l.trim())
                                 .filter(l => l && l !== 'osd');
                
                let engIndex = langs.indexOf('eng');
                if (engIndex !== -1) {
                    langs.splice(engIndex, 1);
                    langs.push('eng');
                }

                return langs.join('+');
            }
        } catch (e) {
            console.error(`[${this.metadata.uuid}] Failed to get langs: ${e.message}`);
        }
        return 'eng';
    }

    _runTesseract(filePath, shouldDelete = false) {
        try {
            if (this._ocrCancellable) {
                this._ocrCancellable.cancel();
            }
            this._ocrCancellable = new Gio.Cancellable();

            let allLangs = this._getInstalledLangs();

            let argv = ['tesseract', filePath, 'stdout'];
            if (allLangs) {
                argv.push('-l', allLangs);
            }

            let proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            });

            proc.init(this._ocrCancellable);

            proc.communicate_utf8_async(null, this._ocrCancellable, (proc, res) => {
                try {
                    let [ok, stdout, stderr] = proc.communicate_utf8_finish(res);

                    if (ok && stdout) {
                        let text = stdout.trim();
                        if (text) {
                            this._copyToClipboard(text);
                        } 
                    } else {
                        if (!stderr.includes('Interrupted system call')) {
                            console.debug(`[${this.metadata.uuid}] Tesseract stderr: ${stderr}`);
                        }
                    }
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        console.error(`[${this.metadata.uuid}] Tesseract failed: ${e.message}`);
                    }
                } finally {
                    // Delete the temporary screenshot file if OCR mode was used
                    if (shouldDelete) {
                        try {
                            let file = Gio.File.new_for_path(filePath);
                            if (file.query_exists(null)) {
                                file.delete(null);
                            }
                        } catch (err) {
                            console.warn(`[${this.metadata.uuid}] Failed to delete temp file: ${err.message}`);
                        }
                    }
                }
            });
        } catch (e) {
            console.error(`[${this.metadata.uuid}] Failed to launch subprocess: ${e.message}`);
        }
    }

    _copyToClipboard(text) {
        let clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    }

    disable() {
        if (this._ocrCancellable) {
            this._ocrCancellable.cancel();
            this._ocrCancellable = null;
        }

        if (Main.screenshotUI) {
            if (this._signalId) {
                Main.screenshotUI.disconnect(this._signalId);
                this._signalId = 0;
            }
            
            // Remove the added button
            if (Main.screenshotUI._ocrButton) {
                Main.screenshotUI._ocrButton.destroy();
                Main.screenshotUI._ocrButton = null;
            }
        }

        if (this._openOverride) {
            if (ScreenshotUI.prototype.open === this._myOpenWrapper) {
                ScreenshotUI.prototype.open = this._originalOpen;
            } else {
                console.warn(`[${this.metadata.uuid}] ScreenshotUI.prototype.open was modified by another extension; skipping restore.`);
            }
            
            this._originalOpen = null;
            this._myOpenWrapper = null;
            this._openOverride = false;
        }
    }
}