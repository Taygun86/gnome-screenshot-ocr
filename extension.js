import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class OcrScreenshotExtension extends Extension {
    enable() {
        this._signalId = 0;
        this._ocrCancellable = null;

        // In GNOME 49, the screenshot UI is already available, so we connect directly.
        // Removed the legacy monkey-patching of Main.openScreenshotUI which causes read-only TypeError.
        if (Main.screenshotUI) {
            this._connectSignal();
        } else {
            console.error(`[${this.metadata.uuid}] Main.screenshotUI is not ready yet.`);
        }
    }

    _connectSignal() {
        if (this._signalId) return;

        console.debug(`[${this.metadata.uuid}] Connecting to screenshot-taken signal`);
        this._signalId = Main.screenshotUI.connect('screenshot-taken', (ui, file) => {
            if (file) {
                this._runTesseract(file.get_path());
            }
        });
    }

    _runTesseract(filePath) {
        try {
            // Cancel any previous running OCR tasks to prevent overlap
            if (this._ocrCancellable) {
                this._ocrCancellable.cancel();
            }
            this._ocrCancellable = new Gio.Cancellable();

            // Added Turkish and English language support (-l tur+eng)
            let proc = new Gio.Subprocess({
                argv: ['tesseract', filePath, 'stdout', '-l', 'tur+eng'],
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
                        // Only log real errors, not cancellations
                        if (!stderr.includes('Interrupted system call')) {
                            console.debug(`[${this.metadata.uuid}] Tesseract stderr: ${stderr}`);
                        }
                    }
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        console.error(`[${this.metadata.uuid}] Tesseract failed: ${e.message}`);
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
        // 1. Cancel any running OCR process
        if (this._ocrCancellable) {
            this._ocrCancellable.cancel();
            this._ocrCancellable = null;
        }

        // 2. Disconnect signal
        if (Main.screenshotUI && this._signalId) {
            Main.screenshotUI.disconnect(this._signalId);
            this._signalId = 0;
        }
    }
}