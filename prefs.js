import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class OcrScreenshotPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        let wrapper;

        // Get installed list
        let installedLangs = [];
        try {
            let [ok, stdout, stderr] = GLib.spawn_command_line_sync('tesseract --list-langs');
            if (ok && stdout) {
                let output = new TextDecoder().decode(stdout);
                let lines = output.split('\n');
                installedLangs = lines.slice(1)
                                      .map(l => l.trim())
                                      .filter(l => l && l !== 'osd');
            }
        } catch (e) {
            console.error(e);
        }

        let userVal = settings.get_user_value('languages');
        let savedLangsString = settings.get_string('languages');
        let selectedLangs = [];

        if (userVal !== null) {
            selectedLangs = savedLangsString ? savedLangsString.split('+') : [];
        } else {
             selectedLangs = [...installedLangs];
             let engIndex = selectedLangs.indexOf('eng');
             if (engIndex !== -1) {
                 selectedLangs.splice(engIndex, 1);
                 selectedLangs.push('eng');
             }
             settings.set_string('languages', selectedLangs.join('+'));
        }

        let currentOrder = Array.from(new Set([...selectedLangs, ...installedLangs]));
        let enabledMap = {}; 
        installedLangs.forEach(l => enabledMap[l] = false);
        selectedLangs.forEach(l => enabledMap[l] = true);

        currentOrder.sort((a,b) => {
             let aSel = selectedLangs.indexOf(a);
             let bSel = selectedLangs.indexOf(b);
             if (aSel !== -1 && bSel !== -1) return aSel - bSel;
             if (aSel !== -1) return -1;
             if (bSel !== -1) return 1;
             return a.localeCompare(b);
        });

        const renderList = () => {
            if (wrapper) {
                page.remove(wrapper);
            }
            wrapper = new Adw.PreferencesGroup({
                title: _('Tesseract OCR Languages'),
                description: _('Toggle languages and move them up/down to change priority. High priority languages will help Tesseract decide during OCR.')
            });
            page.add(wrapper);

            currentOrder.forEach((lang, index) => {
                let row = new Adw.ActionRow({
                    title: lang,
                });

                let switchWidget = new Gtk.Switch({
                    active: enabledMap[lang] || false,
                    valign: Gtk.Align.CENTER
                });
                
                switchWidget.connect('notify::active', () => {
                    enabledMap[lang] = switchWidget.active;
                    let active = currentOrder.filter(l => enabledMap[l]);
                    settings.set_string('languages', active.join('+'));
                });

                let upBtn = new Gtk.Button({
                    icon_name: 'go-up-symbolic',
                    valign: Gtk.Align.CENTER,
                    margin_end: 5
                });
                upBtn.connect('clicked', () => {
                    if (index > 0) {
                        let tmp = currentOrder[index - 1];
                        currentOrder[index - 1] = currentOrder[index];
                        currentOrder[index] = tmp;
                        let active = currentOrder.filter(l => enabledMap[l]);
                        settings.set_string('languages', active.join('+'));
                        renderList();
                    }
                });
                if (index === 0) upBtn.sensitive = false;

                let downBtn = new Gtk.Button({
                    icon_name: 'go-down-symbolic',
                    valign: Gtk.Align.CENTER,
                    margin_end: 10
                });
                downBtn.connect('clicked', () => {
                    if (index < currentOrder.length - 1) {
                        let tmp = currentOrder[index + 1];
                        currentOrder[index + 1] = currentOrder[index];
                        currentOrder[index] = tmp;
                        let active = currentOrder.filter(l => enabledMap[l]);
                        settings.set_string('languages', active.join('+'));
                        renderList();
                    }
                });
                if (index === currentOrder.length - 1) downBtn.sensitive = false;

                let box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
                box.append(upBtn);
                box.append(downBtn);
                row.add_suffix(box);
                row.add_suffix(switchWidget);

                wrapper.add(row);
            });
        };

        renderList();
    }
}
