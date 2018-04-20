"use strict";

const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;

// Local Imports
imports.searchPath.push(gsconnect.datadir);
const DBus = imports.modules.dbus;


function section_separators(row, before) {
    if (before) {
        row.set_header(new Gtk.Separator({ visible: true }));
    }
};


function switcher_separators(row, before) {
    if (before && row.type !== before.type) {
        row.set_header(new Gtk.Separator({ visible: true }));
    }
};


// FIXME: this is garbage
function mapWidget(settings, widget, map) {
    let row = widget.get_parent().get_parent();
    row.visible = (settings);

    // Init the widget
    let value = settings.get_uint("allow");
    widget.label = (map.get(value) !== undefined) ? map.get(value) : value.toString();

    // Watch settings for changes
    let _changed = settings.connect("changed::allow", () => {
        let value = settings.get_uint("allow");
        widget.label = (map.get(value) !== undefined) ? map.get(value) : value.toString();
    });
    widget.connect_after("destroy", () => settings.disconnect(_changed));

    // Watch the Gtk.ListBox for activation
    row.get_parent().connect("row-activated", (box, arow) => {
        if (row === arow) {
            let currentValue = settings.get_uint("allow");
            let next = false;
            let newValue;

            for (let [k, v] of map) {
                if (next) {
                    newValue = k;
                    break;
                } else if (k === currentValue) {
                    next = true;
                }
            }

            if (newValue === undefined) {
                newValue = map.keys().next().value;
            }

            settings.set_uint("allow", newValue);
        }
    });
};


function mapFlagToBool(settings, label, on) {
    let row = label.get_parent().get_parent();
    row.visible = (settings);

    if (settings) {
        // Set the intial label
        label.label = (settings.get_uint("allow") & on) ? _("On") : _("Off");

        // Watch settings for changes
        let _changed = settings.connect("changed::allow", () => {
            label.label = (settings.get_uint("allow") & on) ? _("On") : _("Off");
        });
        label.connect_after("destroy", () => settings.disconnect(_changed));

        // Watch the Gtk.ListBox for activation
        row.get_parent().connect("row-activated", (box, arow) => {
            if (row === arow) {
                settings.set_uint("allow", settings.get_uint("allow") ^ on);
            }
        });
    }
};


function mapBoolLabel(settings, key, label) {
    let row = label.get_parent().get_parent();
    row.visible = (settings);

    if (settings) {
        // Set the intial label
        label.label = settings.get_boolean(key) ? _("On") : _("Off");

        // Watch settings for changes
        let _changed = settings.connect("changed::" + key, () => {
            label.label = settings.get_boolean(key) ? _("On") : _("Off");
        });
        label.connect_after("destroy", () => settings.disconnect(_changed));

        // Watch the Gtk.ListBox for activation
        row.get_parent().connect("row-activated", (box, arow) => {
            if (row === arow) {
                settings.set_boolean(key, !settings.get_boolean(key));
            }
        });
    }
};


function mapAllow(settings, label) {
    let map = new Map([
        [1, _("Off")],
        [2, _("To Device")],
        [4, _("From Device")],
        [6, _("Both")]
    ]);

    return mapWidget(settings, label, map);
};


Gio.Settings.prototype.bind_with_mapping = function(key, object, property, flags=0, get_mapping, set_mapping) {
    let type = "";

    if ((flags & Gio.SettingsBindFlags.GET) || flags === 0) {
        let _getChanged = this.connect(
            "changed::" + key,
            () => get_mapping(this.get_value(key))
        );
        object.connect("destroy", () => this.disconnect(_getChanged));
    }

    if ((flags & Gio.SettingsBindFlags.SET) || flags === 0) {
        let _setChanged = object.connect(
            "notify::" + property,
            () => set_mapping(object[property])
        );
        object.connect("destroy", () => object.disconnect(_setChanged));
    }
};


function mapSwitch(settings, widget, [on, off]=[6, 4]) {
    settings.bind_with_mapping(
        "allow",
        widget,
        "active",
        0,
        variant => { widget.active = (variant.unpack() === on); },
        value => settings.set_uint("allow", (value) ? on : off)
    );
    widget.active = (settings.get_uint('allow') === on);
};


/**
 * A simple dialog for selecting a device
 */
var DeviceChooser = GObject.registerClass({
    GTypeName: "GSConnectDeviceChooser"
}, class DeviceChooserDialog extends Gtk.Dialog {

    _init(params) {
        super._init({
            use_header_bar: true,
            application: Gio.Application.get_default(),
            default_width: 300,
            default_height: 200
        });
        this.set_keep_above(true);

        // HeaderBar
        let headerBar = this.get_header_bar();
        headerBar.title = _("Select a Device");
        headerBar.subtitle = params.title;
        headerBar.show_close_button = false;

        let selectButton = this.add_button(_("Select"), Gtk.ResponseType.OK);
        selectButton.sensitive = false;
        this.add_button(_("Cancel"), Gtk.ResponseType.CANCEL);
        this.set_default_response(Gtk.ResponseType.OK);

        // Device List
        let scrolledWindow = new Gtk.ScrolledWindow({
            hexpand: true,
            vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER
        });
        this.get_content_area().add(scrolledWindow);

        this.list = new Gtk.ListBox({ activate_on_single_click: false });
        this.list.connect("row-activated", (list, row) => {
            this.response(Gtk.ResponseType.OK);
        });
        this.list.connect("selected-rows-changed", () => {
            selectButton.sensitive = (this.list.get_selected_rows().length);
        });
        scrolledWindow.add(this.list);

        this._populate(params.devices);
        scrolledWindow.show_all();
    }

    _populate(devices) {
        for (let device of devices) {
            let row = new Gtk.ListBoxRow();
            row.device = device;
            this.list.add(row);

            let box = new Gtk.Box({
                margin: 6,
                spacing: 6
            });
            row.add(box);

            let icon = new Gtk.Image({
                icon_name: device.type,
                pixel_size: 32
            });
            box.add(icon);

            let name = new Gtk.Label({
                label: device.name,
                halign: Gtk.Align.START,
                hexpand: true
            });
            box.add(name);
        }
    }
});


/**
 * A row for a stack sidebar
 */
var SidebarRow = GObject.registerClass({
    GTypeName: "GSConnectSidebarRow"
}, class SidebarRow extends Gtk.ListBoxRow {

    _init(params) {
        super._init({
            selectable: true,
            visible: true
        });

        this.type = params.type || undefined;
        this.set_name(params.name);

        this.box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            margin_left: 8,
            margin_right: 8,
            margin_bottom: 12,
            margin_top: 12,
            visible: true
        });
        this.add(this.box);

        this.icon = new Gtk.Image({
            icon_name: params.icon,
            pixel_size: 16,
            visible: true
        });
        this.box.add(this.icon);

        this.title = new Gtk.Label({
            label: params.title,
            halign: Gtk.Align.START,
            hexpand: true,
            valign: Gtk.Align.CENTER,
            vexpand: true,
            visible: true
        });
        this.box.add(this.title);

        // A '>' image for rows that are like submenus
        if (params.show_go_next) {
            this.go_next = new Gtk.Image({
                icon_name: "go-next-symbolic",
                pixel_size: 16,
                halign: Gtk.Align.END,
                visible: true
            });
            this.box.add(this.go_next);
        }
    }
});


/**
 * A row for a section of settings
 */
var SectionRow = GObject.registerClass({
    GTypeName: "GSConnectSectionRow"
}, class SidebarRow extends Gtk.ListBoxRow {

    _init(params) {
        let icon_name = params.icon_name;
        let title = params.title;
        let subtitle = params.subtitle;
        let widget = params.widget;
        delete params.icon_name;
        delete params.title;
        delete params.subtitle;
        delete params.widget;

        super._init(Object.assign({
            activatable: true,
            selectable: false,
            height_request: 56,
            visible: true
        }, params));

        this.grid = new Gtk.Grid({
            column_spacing: 12,
            margin_top: 8,
            margin_right: 12,
            margin_bottom: 8,
            margin_left: 12,
            visible: true
        });
        this.add(this.grid);

        if (icon_name) {
            this.icon = new Gtk.Image({
                gicon: new Gio.ThemedIcon({
                    names: [ icon_name, "system-run-symbolic" ]
                }),
                pixel_size: 32,
                visible: true
            });

            this.height_request = 56;
            this.grid.attach(this.icon, 0, 0, 1, 2);
        }

        if (title) {
            this.title = new Gtk.Label({
                label: title,
                halign: Gtk.Align.START,
                hexpand: true,
                valign: Gtk.Align.CENTER,
                vexpand: true,
                visible: true
            });
            this.grid.attach(this.title, 1, 0, 1, 1);
        }

        if (subtitle) {
            this.subtitle = new Gtk.Label({
                label: subtitle,
                halign: Gtk.Align.START,
                hexpand: true,
                valign: Gtk.Align.CENTER,
                vexpand: true,
                visible: true
            });
            this.subtitle.get_style_context().add_class("dim-label");
            this.grid.attach(this.subtitle, 1, 1, 1, 1);
        }

        if (widget) {
            this.widget = widget;
            this.grid.attach(this.widget, 2, 0, 1, 2);
        }
    }
});


var SettingsWindow = GObject.registerClass({
    GTypeName: "GSConnectSettingsWindow",
    Template: "resource:///org/gnome/Shell/Extensions/GSConnect/settings.ui",
    Children: [
        "headerbar",
        "headerbar-title", "headerbar-subtitle", "headerbar-edit", "headerbar-entry",
        "prev-button", "device-menu",
        "stack", "switcher", "sidebar",
        "shell-list",
        "show-indicators", "show-offline", "show-unpaired", "show-battery",
        "extensions-list",
        "files-integration", "webbrowser-integration",
        "advanced-list",
        "debug-mode", "debug-window",
        "help", "help-list"
    ]
}, class SettingsWindow extends Gtk.ApplicationWindow {

    _init(params) {
        Gtk.Widget.set_connect_func.call(this, (builder, obj, signalName, handlerName, connectObj, flags) => {
            obj.connect(signalName, this[handlerName].bind(this));
        });

        super._init(params);

        // Header Bar
        this.headerbar_title.label = this.application.name;
        this.headerbar_subtitle.label = null;

        // Sidebar
        this.help.type = "device";
        this.switcher.set_header_func(switcher_separators);
        this.switcher.select_row(this.switcher.get_row_at_index(0));

        // Init UI Elements
        this._bindSettings();

        // Broadcasting
        this._refreshSource = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            5,
            () => {
                if (this.sidebar.get_visible_child_name() === "switcher") {
                    this.application.broadcast();
                }
                return true;
            }
        );

        // Setup devices
        this._serviceDevices = this.application.connect(
            "notify::devices",
            this._onDevicesChanged.bind(this)
        );
        this._onDevicesChanged();

        // Cleanup
        this.connect("destroy", () => {
            GLib.source_remove(this._refreshSource);
            this.application.disconnect(this._serviceDevices);
        });
    }

    /**
     * HeaderBar Callbacks
     */
    _onPrevious(button, event) {
        this.headerbar_title.label = this.application.name;
        this.headerbar_subtitle.visible = false;
        this.headerbar_edit.visible = true;
        this.sidebar.set_visible_child_name("switcher");

        this.switcher.get_row_at_index(0).emit("activate");
        this.prev_button.visible = false;

        this.device_menu.visible = false;
        this.device_menu.insert_action_group("device", null);
        this.device_menu.menu_model = null;
    }

    _onEditServiceName(button, event) {
        this.headerbar_entry.text = this.application.name;
        this.headerbar_entry.visible = true;
        this.headerbar_title.visible = false;
        this.headerbar_edit.visible = false;
    }

    _onSetServiceName(button, event) {
        this.application.name = this.headerbar_entry.text;
        this.headerbar_title.label = this.application.name;

        this.headerbar_entry.visible = false;
        this.headerbar_title.visible = true;
        this.headerbar_edit.visible = true;
    }

    /**
     * Context Switcher
     */
    _onSwitcherRowSelected(box, row) {
        // I guess this is being called before the template children are ready
        if (!this.stack) { return; }

        row = row || this.switcher.get_row_at_index(0);
        let name = row.get_name() || null;

        this.stack.set_visible_child_name(name);

        if (this.sidebar.get_child_by_name(name)) {
            let device = this.stack.get_visible_child().device;

            this.headerbar_title.label = row.title.label;
            this.headerbar_subtitle.label = this.stack.get_visible_child().device_type.label;
            this.headerbar_subtitle.visible = true;
            this.headerbar_edit.visible = false;

            this.sidebar.set_visible_child_name(name);
            this.prev_button.visible = true;

            this.device_menu.insert_action_group('device', device);
            this.device_menu.set_menu_model(device.menu);
            this.device_menu.visible = true;
        }
    }

    /**
     * UI Setup and template connecting
     */
    _bindSettings() {
        // Shell
        mapBoolLabel(gsconnect.settings, "show-indicators", this.show_indicators);
        mapBoolLabel(gsconnect.settings, "show-offline", this.show_offline);
        mapBoolLabel(gsconnect.settings, "show-unpaired", this.show_unpaired);
        mapBoolLabel(gsconnect.settings, "show-battery", this.show_battery);
        this.shell_list.set_header_func(section_separators);

        // Extensions
        // TODO: these should go..
        mapBoolLabel(gsconnect.settings, "nautilus-integration", this.files_integration);
        mapBoolLabel(gsconnect.settings, "webbrowser-integration", this.webbrowser_integration);
        this.extensions_list.set_header_func(section_separators);

        // Application Extensions
        mapBoolLabel(gsconnect.settings, "debug", this.debug_mode);
        this.debug_window.connect("clicked", () => {
            GLib.spawn_command_line_async(
                'gnome-terminal ' +
                '--tab --title "GJS" --command "journalctl -f -o cat /usr/bin/gjs" ' +
                '--tab --title "Gnome Shell" --command "journalctl -f -o cat /usr/bin/gnome-shell"'
            );
        });
        this.advanced_list.set_header_func(section_separators);
    }

    _onDevicesChanged() {
        for (let dbusPath of this.application.devices) {
            if (!this.stack.get_child_by_name(dbusPath)) {
                this.addDevice(dbusPath);
            }
        }

        this.stack.foreach(child => {
            if (child.row) {
                let name = child.row.get_name();
                if (this.application.devices.indexOf(name) < 0) {
                    this.stack.get_child_by_name(name).destroy();
                }
            }
        });

        this.help.visible = !this.application.devices.length;
    }

    addDevice(dbusPath) {
        let device = this.application._devices.get(dbusPath);

        // Create a new device widget
        let panel = new DeviceSettings(device);

        // Add device to switcher, and panel stack
        this.stack.add_titled(panel, dbusPath, device.name);
        this.sidebar.add_named(panel.switcher, dbusPath);
        this.switcher.add(panel.row);
    }
});


var DeviceSettings = GObject.registerClass({
    GTypeName: "GSConnectDeviceSettings",
    Properties: {
        "connected": GObject.ParamSpec.boolean(
            "connected",
            "deviceConnected",
            "Whether the device is connected",
            GObject.ParamFlags.READWRITE,
            false
        ),
        "paired": GObject.ParamSpec.boolean(
            "paired",
            "devicePaired",
            "Whether the device is paired",
            GObject.ParamFlags.READWRITE,
            false
        )
    },
    Template: "resource:///org/gnome/Shell/Extensions/GSConnect/device.ui",
    Children: [
        "switcher",
        // Device
        "device-icon", "device-name", "device-type",
        "battery-level", "battery-percent", "battery-condition",
        "device-status-list",
        "device-connected", "device-connected-image", "device-connected-text",
        "device-paired", "device-paired-image", "device-paired-text",
        // RunCommand
        "commands", "command-list", "command-new", "command-editor",
        "command-icon", "command-name", "command-line",
        "command-trash", "command-save",
        // Notifications
        "notification", "notification-page",
        "notification-allow", "notification-apps",
        // Sharing
        "sharing", "sharing-page", "sharing-list",
        "battery-allow", "share-allow", "clipboard-allow", "mpris-allow",
        "mousepad-allow", "findmyphone-allow",
        // Events
        "events-list",
        //TODO
        // Shortcuts
        "shortcuts-list"
    ]
}, class DeviceSettings extends Gtk.Stack {

    _init(device, params={}) {
        Gtk.Widget.set_connect_func.call(this, (builder, obj, signalName, handlerName, connectObj, flags) => {
            obj.connect(signalName, this[handlerName].bind(this));
        });

        super._init(params);

        this.service = Gio.Application.get_default();
        this.device = device;

        // Device Status
        this.connect("notify::connected", this._onConnected.bind(this));
        this.device.bind_property("connected", this, "connected", GObject.BindingFlags.SYNC_CREATE);

        this.connect("notify::paired", this._onPaired.bind(this));
        this.device.bind_property("paired", this, "paired", GObject.BindingFlags.SYNC_CREATE);

        this.device_status_list.set_header_func(section_separators);

        // Sidebar Row
        this.row = new SidebarRow({
            icon: this._getSymbolicIcon(),
            title: device.name,
            type: "device",
            name: device._dbus.get_object_path(),
            show_go_next: true
        });

        // Info Pane
        this.device_name.label = this.device.name;
        this.device_type.label = this.device.display_type;
        this.device_icon.icon_name = this.device.icon_name;

        // Settings Pages
        //this._batteryBar();
        this._sharingSettings();
        this._runcommandSettings();
        this._notificationSettings();
        this._eventsSettings();
        this._keyboardShortcuts();

        // Cleanup
        this.connect_after("destroy", (widget) => {
            widget.device.settings.disconnect(widget._keybindingsId);

            widget.switcher.destroy();
            widget.row.destroy();

            if (widget._batteryId) {
                widget.device._plugins.get("battery").disconnect(
                    widget._batteryId
                );
            }
        });
    }

    _getSymbolicIcon(widget) {
        if (!this.paired) {
            let icon = this.device.icon_name;
            icon = (icon === "computer") ? "desktop" : icon;
            return icon + "disconnected";
        }

        return this.device.icon_name + "-symbolic";
    }

    _getSettings(name) {
        if (this._gsettings === undefined) {
            this._gsettings = {};
        }

        if (this._gsettings[name]) {
            return this._gsettings[name];
        }

        if (this.device.supportedPlugins().indexOf(name) > -1) {
            let meta = imports.service.plugins[name].Metadata;

            this._gsettings[name] = new Gio.Settings({
                settings_schema: gsconnect.gschema.lookup(meta.id, -1),
                path: `${gsconnect.settings.path}device/${this.device.id}/plugin/${name}/`
            });
        }

        return this._gsettings[name] || false;
    }

    _onConnected() {
        if (this.connected) {
            this.device_connected_image.icon_name = "emblem-ok-symbolic";
            this.device_connected_text.label = _("Device is connected");
            this.device_connected.set_tooltip_markup(null);
        } else {
            this.device_connected_image.icon_name = "emblem-synchronizing-symbolic";
            this.device_connected_text.label = _("Device is disconnected");
            this.device_connected.set_tooltip_markup(
                // TRANSLATORS: eg. Reconnect <b>Google Pixel</b>
                _("Reconnect <b>%s</b>").format(this.device.name)
            );
        }

        this.device_paired.sensitive = this.connected;
    }

    _onPaired() {
        if (this.paired) {
            this.device_paired_image.icon_name = "application-certificate-symbolic";
            this.device_paired_text.label = _("Device is paired");
            this.device_paired.set_tooltip_markup(
                // TRANSLATORS: eg. Unpair <b>Google Pixel</b>
                _("Unpair <b>%s</b>").format(this.device.name)
            );
        } else {
            this.device_paired_image.icon_name = "channel-insecure-symbolic";
            this.device_paired_text.label = _("Device is unpaired");
            this.device_paired.set_tooltip_markup(
                // TRANSLATORS: eg. Pair <b>Google Pixel</b>
                _("Pair <b>%s</b>").format(this.device.name) + "\n\n" +
                // TRANSLATORS: Remote and local TLS Certificate fingerprint
                // PLEASE KEEP NEWLINE CHARACTERS (\n)
                //
                // Example:
                //
                // <b>Google Pixel Fingerprint:</b>
                // 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00
                //
                // <b>Local Fingerprint:</b>
                // 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00
                _("<b>%s Fingerprint:</b>\n%s\n\n<b>Local Fingerprint:</b>\n%s").format(
                    this.device.name,
                    this.device.fingerprint,
                    this.service.fingerprint
                )
            );
        }

        if (this.row) {
            this.row.icon.icon_name = this._getSymbolicIcon();
        }
    }

    _onStatusRowActivated(box, row) {
        if (row === this.device_connected) {
            this.device.activate();
        } else if (row === this.device_paired) {
            this.device.paired ? this.device.unpair() : this.device.pair();
        }
    }

    _onSwitcherRowSelected(box, row) {
        this.set_visible_child_name(row.get_name());
    }

    /**
     * Battery Level
     */
    _batteryBar() {
        let battery = this.device._plugins.get("battery");

        if (battery) {
            this.battery_level.get_style_context().add_class("battery-bar");

            this._batteryId = battery.connect("notify", (plugin) => {
                let level = plugin.level;

                this.battery_level.visible = (level > -1);
                this.battery_condition.visible = (level > -1);
                this.battery_percent.visible = (level > -1);

                if (level > -1) {
                    this.battery_level.value = level;
                    this.battery_percent.label = _("%d%%").format(level);

                    if (battery.charging) {
                        this.battery_condition.label = _("Charging...");
                    } else if (level < 10) {
                        this.battery_condition.label = _("Caution");
                    } else if (level < 30) {
                        this.battery_condition.label = _("Low");
                    } else if (level < 60) {
                        this.battery_condition.label = _("Good");
                    } else if (level >= 60) {
                        this.battery_condition.label = _("Full");
                    }
                }
            });

            battery.notify("level");
            battery.connect_after("destroy", () => {
                this.battery_level.visible = false;
                this.battery_condition.visible = false;
                this.battery_percent.visible = false;
            });
        } else {
            this.battery_level.visible = false;
            this.battery_condition.visible = false;
            this.battery_percent.visible = false;
        }
    }

    /**
     * RunCommand Page
     * TODO: maybe action<->commands?
     */
    _runcommandSettings() {
        let runcommand = this._getSettings("runcommand");

        if (runcommand) {
            // Local Command List
            this._commands = gsconnect.full_unpack(
                runcommand.get_value("command-list")
            );

            this.command_list.set_sort_func((row1, row2) => {
                // The add button
                if (row1.get_child() instanceof Gtk.Image) {
                    return 1;
                } else if (row2.get_child() instanceof Gtk.Image) {
                    return -1;
                // Compare uuid???
                } else if (row1.uuid && row1.uuid === row2.get_name()) {
                    return 1;
                } else if (row2.uuid && row2.uuid === row1.get_name()) {
                    return -1;
                // Shouldn't happen?!
                } else if (!row1.title || !row2.title) {
                    return 0;
                }

                return row1.title.label.localeCompare(row2.title.label);
            });
            this.command_list.set_header_func(section_separators);
            this._populateCommands();
        } else {
            this.commands.visible = false;
        }
    }

    _onCommandNameChanged(entry) {
        this.command_icon.gicon = new Gio.ThemedIcon({
            names: [ entry.text.toLowerCase(), "application-x-executable" ]
        });
    }

    _insertCommand(uuid) {
        let row = new SectionRow({
            icon_name: this._commands[uuid].name.toLowerCase(),
            title: this._commands[uuid].name,
            subtitle: this._commands[uuid].command,
            widget: new Gtk.Button({
                image: new Gtk.Image({
                    icon_name: "document-edit-symbolic",
                    pixel_size: 16,
                    visible: true
                }),
                halign: Gtk.Align.END,
                valign: Gtk.Align.CENTER,
                vexpand: true,
                visible: true
            })
        });
        row.set_name(uuid);
        row.widget.get_style_context().add_class("circular");
        row.widget.get_style_context().add_class("flat");
        row.widget.connect("clicked", () => this._editCommand(row, uuid));

        this.command_list.add(row);

        return row;
    }

    _newCommand(box, row) {
        if (row === this.command_new) {
            let uuid = GLib.uuid_string_random();
            this._commands[uuid] = { name: "", command: "" };
            this._editCommand(this._insertCommand(uuid), uuid);
        }
    }

    _populateCommands() {
        this.command_list.foreach(row => {
            if (row !== this.command_new && row !== this.command_editor) {
                row.destroy();
            }
        });

        for (let uuid in this._commands) {
            this._insertCommand(uuid);
        }
    }

    _saveCommand() {
        if (this.command_name.text && this.command_line.text) {
            let cmd = this._commands[this.command_editor.uuid];
            cmd.name = this.command_name.text.slice(0);
            cmd.command = this.command_line.text.slice(0);
        } else {
            delete this._commands[this.command_editor.uuid];
        }

        this._getSettings("runcommand").set_value(
            "command-list",
            gsconnect.full_pack(this._commands)
        );

        this._resetCommandEditor();
    }

    _resetCommandEditor(button) {
        delete this.command_editor.title;
        this.command_name.text = "";
        this.command_line.text = "";

        this.command_list.foreach(row => {
            if (row.get_name() === this.command_editor.uuid) {
                row.visible = true;
            }
        });
        delete this.command_editor.uuid;

        this.command_new.visible = true;
        this.command_editor.visible = false;
        this.command_list.invalidate_sort();

        this._populateCommands();
    }

    _editCommand(row, uuid) {
        this.command_editor.uuid = uuid;
        this.command_name.text = this._commands[uuid].name.slice(0);
        this.command_line.text = this._commands[uuid].command.slice(0);

        this.command_editor.title = { label: this.command_name.text };
        this.command_list.foreach(row => {
            if (row.get_name() === uuid) {
                row.visible = false;
            }
        });

        this.command_new.visible = false;
        this.command_editor.visible = true;
        this.command_list.invalidate_sort();
    }

    _browseCommand(entry, icon_pos, event) {
        let filter = new Gtk.FileFilter();
        filter.add_mime_type("application/x-executable");

        let dialog = new Gtk.FileChooserDialog({ filter: filter });
        dialog.add_button(_("Cancel"), Gtk.ResponseType.CANCEL);
        dialog.add_button(_("Open"), Gtk.ResponseType.OK);

        if (dialog.run() === Gtk.ResponseType.OK) {
            this.command_line.text = dialog.get_filename();
        }

        dialog.destroy();
    }

    _removeCommand(button) {
        delete this._commands[this.command_editor.uuid];

        this._getSettings("runcommand").set_value(
            "command-list",
            gsconnect.full_pack(this._commands)
        );

        this._resetCommandEditor();
    }

    /**
     * Notification Settings
     */
    _notificationSettings() {
        let notification = this._getSettings("notification");

        if (notification) {
            mapSwitch(notification, this.notification_allow, [ 6, 4 ]);

            // Populate, sort and separate
            this._populateApplications(notification);
            this.notification_apps.set_sort_func((row1, row2) => {
                return row1.title.label.localeCompare(row2.title.label);
            });
            this.notification_apps.set_header_func(section_separators);

            this.notification_allow.bind_property(
                "active",
                this.notification_apps,
                "sensitive",
                GObject.BindingFlags.SYNC_CREATE
            );
        } else {
            this.notification.visible = false;
        }
    }

    _onNotificationRowActivated(box, row) {
        let notification = this._getSettings("notification");
        let applications = JSON.parse(notification.get_string("applications"));

        if (row.enabled.label === _("On")) {
            applications[row.title.label].enabled = false;
            row.enabled.label = _("Off");
        } else {
            applications[row.title.label].enabled = true;
            row.enabled.label = _("On");
        }

        notification.set_string("applications", JSON.stringify(applications));
    }

    _populateApplications(notification) {
        let applications = this._queryApplications(notification);

        for (let name in applications) {
            let row = new SectionRow({
                icon_name: applications[name].iconName,
                title: name,
                height_request: 48
            });

            row.enabled = new Gtk.Label({
                label: applications[name].enabled ? _("On") : _("Off"),
                margin_end: 12,
                halign: Gtk.Align.END,
                hexpand: true,
                valign: Gtk.Align.CENTER,
                vexpand: true,
                visible: true
            });
            row.grid.attach(row.enabled, 2, 0, 1, 1);

            this.notification_apps.add(row);
        }
    }

    _queryApplications(notification) {
        let applications = {};

        try {
            applications = JSON.parse(notification.get_string("applications"));
        } catch (e) {
            applications = {};
        }

        let appInfos = [];
        let ignoreId = "org.gnome.Shell.Extensions.GSConnect.desktop";

        // Query Gnome's notification settings
        for (let app of this.service._desktopNotificationSettings.get_strv("application-children")) {
            let appSettings = new Gio.Settings({
                schema_id: "org.gnome.desktop.notifications.application",
                path: "/org/gnome/desktop/notifications/application/" + app + "/"
            });

            let appId = appSettings.get_string("application-id");

            if (appId !== ignoreId) {
                let appInfo = Gio.DesktopAppInfo.new(appId);

                if (appInfo) {
                    appInfos.push(appInfo);
                }
            }
        }

        // Include applications that statically declare to show notifications
        Gio.AppInfo.get_all().map(appInfo => {
            if (appInfo.get_id() !== ignoreId &&
                appInfo.get_boolean("X-GNOME-UsesNotifications")) {
                appInfos.push(appInfo);
            }
        });

        // Update GSettings
        appInfos.map(appInfo => {
            let appName = appInfo.get_name();
            let icon = appInfo.get_icon();

            if (appName && !applications[appName]) {
                applications[appName] = {
                    iconName: (icon) ? icon.to_string() : 'application-x-executable',
                    enabled: true
                };
            }
        });

        notification.set_string("applications", JSON.stringify(applications));

        return applications;
    }

    /**
     * Sharing Settings
     * TODO: use supported capabilities & gsettings
     */
    _sharingSettings() {
        // Battery
        if (this.device.get_action_enabled("reportStatus")) {
            mapFlagToBool(this._getSettings("battery"), this.battery_allow, 2);
        } else {
            this.battery_allow.get_parent().get_parent().visible = false;
        }

        //mapAllow(this._getSettings("clipboard"), this.clipboard_allow);
        mapFlagToBool(this._getSettings("share"), this.share_allow, 4);
        mapFlagToBool(this._getSettings("mpris"), this.mpris_allow, 4);
        mapFlagToBool(this._getSettings("mousepad"), this.mousepad_allow, 4);
        mapFlagToBool(this._getSettings("findmyphone"), this.findmyphone_allow, 4);

        // Separators & Sorting
        this.sharing_list.set_header_func(section_separators);

        this.sharing_list.set_sort_func((row1, row2) => {
            row1 = row1.get_child().get_child_at(0, 0);
            row2 = row2.get_child().get_child_at(0, 0);
            return row1.label.localeCompare(row2.label);
        });
    }

    /**
     * Events Settings
     */
    _eventsSettings() {
        for (let name of this.device.supportedPlugins()) {
            let meta = imports.service.plugins[name].Metadata;

            if (!meta.events) {
                continue;
            }

            for (let eventName in meta.events) {
                let event = meta.events[eventName];

                let row = new SectionRow({
                    title: event.summary,
                    subtitle: event.description
                });
                row.name = eventName;
                row.event = event;
                row.plugin = name;

                this.events_list.add(row);
            }
        }

        this.events_list.set_header_func(section_separators);
    }

    _onEventRowActivated(box, row) {
        let dialog = new EventEditor(this, row);
        dialog.show();
    }

    /**
     * Keyboard Shortcuts
     */
    _keyboardShortcuts() {
        this._keybindingsId = this.device.settings.connect(
            "changed::keybindings",
            this._populateKeyboardShortcuts.bind(this)
        );
        this._populateKeyboardShortcuts();
    }

    _populateKeyboardShortcuts() {
        this.shortcuts_list.foreach(row => row.destroy());

        //
        let keybindings = {};

        try {
            keybindings = JSON.parse(
                this.device.settings.get_string("keybindings")
            );
        } catch (e) {
            keybindings = {};
        }

        for (let name of this.device.list_actions().sort()) {
            let action = this.device.lookup_action(name)

            if (!action.parameter_type) {
                let widget = new Gtk.Label({
                    label: keybindings[action.name] || _("Disabled"),
                    visible: true
                });
                widget.get_style_context().add_class("dim-label");

                let meta = (action.getMeta) ? action.getMeta() : {};
                let row = new SectionRow({
                    title: meta.summary || name,
                    subtitle: meta.description || name,
                    widget: widget
                });
                row.name = name;
                row.meta = meta;
                this.shortcuts_list.add(row);
            }
        }

        this.shortcuts_list.set_header_func(section_separators);
    }

    _onShortcutRowActivated(box, row) {
        let dialog = new ShortcutEditor({
            summary: row.meta.summary,
            transient_for: box.get_toplevel()
        });

        dialog.connect("response", (dialog, response) => {
            let keybindings = JSON.parse(
                this.device.settings.get_string("keybindings")
            );

            // Set
            if (response === Gtk.ResponseType.OK) {
                keybindings[row.name] = dialog.accelerator;
            // Reset (Backspace)
            } else if (response === 1) {
                keybindings[row.name] = "";
            }

            this.device.settings.set_string(
                "keybindings",
                JSON.stringify(keybindings)
            );

            dialog.destroy();
        });

        dialog.run();
    }
});


var EventEditor = GObject.registerClass({
    GTypeName: "GSConnectEventEditor",
    Template: "resource:///org/gnome/Shell/Extensions/GSConnect/event-editor.ui",
    Children: [
        // HeaderBar
        //"cancel_button", "set_button",
        "headerbar", "action-add", "action-list", "command-editor"
    ]
}, class EventEditor extends Gtk.Dialog {

    _init(page, row) {
        Gtk.Widget.set_connect_func.call(this, (builder, obj, signalName, handlerName, connectObj, flags) => {
            obj.connect(signalName, this[handlerName].bind(this));
        });

        super._init({
            transient_for: page.get_toplevel(),
            use_header_bar: true
        });
        this.get_content_area().border_width = 0;

        this.headerbar.title = row.event.summary;
        this.headerbar.subtitle = row.event.description;

        this._page = page;
        this.device = page.device;
        this._eventName = row.name;
        this._pluginName = row.plugin;

        this.settings = page._getSettings(this._pluginName);
        this._settingsId = this.settings.connect("changed::events", () => this._populate());
        this.connect_after("destroy", () => this.settings.disconnect(this._settingsId));

        // Action List
        this.action_list.set_sort_func(this._sort);
        this.action_list.set_header_func(section_separators);

        this._populate();
    }

    _onRowActivated(box, row) {
        if (row === this.command_editor) { return; }

        let events = gsconnect.full_unpack(this.settings.get_value("events"));
        let eventActions = events[this._eventName];

        eventActions[row.name] = !eventActions[row.name];
        this.settings.set_value("events", gsconnect.full_pack(events));
    }

    _sort(row1, row2) {
        if (!row1.title || !row2.title) { return 0; }
        return row1.title.label.localeCompare(row2.title.label);
    }

    _populate() {
        this.action_list.foreach(row => {
            if (row !== this.command_editor) {
                row.destroy();
            }
        });

        let eventActions = gsconnect.full_unpack(
            this.settings.get_value("events")
        )[this._eventName];

        for (let actionName of this.device.list_actions().sort()) {
            log(JSON.stringify(eventActions));

            let action = this.device.lookup_action(actionName);
            let active = (eventActions[actionName]);

            let widget = new Gtk.Image({
                icon_name: (active) ? "emblem-ok-symbolic" : "",
                visible: true
            });

            let meta = (action.getMeta) ? action.getMeta() : {};
            let row = new SectionRow({
                title: meta.summary || actionName,
                subtitle: meta.description || actionName,
                widget: widget
            });
            row.name = actionName;
            row.meta = meta;

            this.action_list.add(row);
        }
    }
});


var ShellProxy = DBus.makeInterfaceProxy(
    gsconnect.dbusinfo.lookup_interface("org.gnome.Shell")
);


/**
 *
 */
var ShortcutEditor = GObject.registerClass({
    GTypeName: "GSConnectShortcutEditor",
    Template: "resource:///org/gnome/Shell/Extensions/GSConnect/shortcut-editor.ui",
    Children: [
        // HeaderBar
        "cancel_button", "set_button",
        //
        "stack",
        "shortcut-summary",
        "edit-shortcut", "confirm-shortcut",
        "conflict-label"
    ],
    Signals: {
        "result": {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [ GObject.TYPE_STRING ]
        }
    }
}, class ShortcutEditor extends Gtk.Dialog {

    _init(params) {
        // Hack until template callbacks are supported (GJS 1.54?)
        Gtk.Widget.set_connect_func.call(this, (builder, obj, signalName, handlerName, connectObj, flags) => {
            obj.connect(signalName, this[handlerName].bind(this));
        });

        super._init({
            transient_for: params.transient_for,
            use_header_bar: true,
            modal: true
        });

        this.summary = params.summary;
        this.result = "";

        this.shell = new ShellProxy({
            g_connection: Gio.DBus.session,
            g_name: "org.gnome.Shell",
            g_object_path: "/org/gnome/Shell"
        });
        this.shell.init_promise().catch(e => debug(e));

        this.seat = Gdk.Display.get_default().get_default_seat();

        // Content
        this.shortcut_summary.label = _("Enter a new shortcut to change <b>%s</b>").format(this.summary);

        this.shortcut_label = new Gtk.ShortcutLabel({
            accelerator: "",
            disabled_text: _("Disabled"),
            hexpand: true,
            halign: Gtk.Align.CENTER,
            visible: true
        });
        this.confirm_shortcut.attach(this.shortcut_label, 0, 0, 1, 1);
    }

//    /*
//     * Stolen from GtkCellRendererAccel:
//     * https://git.gnome.org/browse/gtk+/tree/gtk/gtkcellrendereraccel.c#n261
//     */
//    gchar*
//    convert_keysym_state_to_string (CcKeyCombo *combo)
//    {
//      gchar *name;

//      if (combo->keyval == 0 && combo->keycode == 0)
//        {
//          /* This label is displayed in a treeview cell displaying
//           * a disabled accelerator key combination.
//           */
//          name = g_strdup (_("Disabled"));
//        }
//      else
//        {
//          name = gtk_accelerator_get_label_with_keycode (NULL, combo->keyval, combo->keycode, combo->mask);

//          if (name == NULL)
//            name = gtk_accelerator_name_with_keycode (NULL, combo->keyval, combo->keycode, combo->mask);
//        }

//      return name;
//    }

    _onKeyPressEvent(widget, event) {
        if (!this._grabId) {
            return false;
        }

        let keyval = event.get_keyval()[1];
        let keyvalLower = Gdk.keyval_to_lower(keyval);

        let state = event.get_state()[1];
        let realMask = state & Gtk.accelerator_get_default_mod_mask();

        // FIXME: Remove modifier keys
        let mods = [
            Gdk.KEY_Alt_L,
            Gdk.KEY_Alt_R,
            Gdk.KEY_Caps_Lock,
            Gdk.KEY_Control_L,
            Gdk.KEY_Control_R,
            Gdk.KEY_Meta_L,
            Gdk.KEY_Meta_R,
            Gdk.KEY_Num_Lock,
            Gdk.KEY_Shift_L,
            Gdk.KEY_Shift_R,
            Gdk.KEY_Super_L,
            Gdk.KEY_Super_R
        ];
        if (mods.indexOf(keyvalLower) > -1) {
            log("returning");
            return true;
        }

        // Normalize Tab
        if (keyvalLower === Gdk.KEY_ISO_Left_Tab) {
            keyvalLower = Gdk.KEY_Tab;
        }

        // Put shift back if it changed the case of the key, not otherwise.
        if (keyvalLower !== keyval) {
            realMask |= Gdk.ModifierType.SHIFT_MASK;
        }

        // HACK: we don't want to use SysRq as a keybinding (but we do want
        // Alt+Print), so we avoid translation from Alt+Print to SysRq
        if (keyvalLower === Gdk.KEY_Sys_Req && (realMask & Gdk.ModifierType.MOD1_MASK) !== 0) {
            keyvalLower = Gdk.KEY_Print;
        }

        // A single Escape press cancels the editing
        // FIXME: or does it...
        if (realMask === 0 && keyvalLower === Gdk.KEY_Esc) {
            return this._onCancel();
        }

        // Backspace disables the current shortcut
        if (realMask === 0 && keyvalLower === Gdk.KEY_BackSpace) {
            return this._onRemove();
        }

        // CapsLock isn't supported as a keybinding modifier, so keep it from
        // confusing us
        realMask &= ~Gdk.ModifierType.LOCK_MASK;

        if (keyvalLower !== 0 && realMask !== 0) {
            this.ungrab();

            this.accelerator = Gtk.accelerator_name(keyvalLower, realMask);
            this.accelerator_label = Gtk.accelerator_get_label(keyvalLower, realMask);

            log("KEYVAL: " + keyvalLower);
            log("MASK: " + realMask);
            log("SHORTCUT: " + this.accelerator);
            log("SHORTCUT: " + this.accelerator_label);

            // Switch to confirm/conflict page
            this.stack.set_visible_child_name("confirm-shortcut");
            // Show shortcut icons
            this.shortcut_label.accelerator = this.accelerator;

            //FIXME
            // If not available, show confliction
            if (!this.check(this.accelerator)) {
                this.conflict_label.visible = true;
                //_("The requested keyboard shortcut is already in use and can't be overridden.")
                this.conflict_label.label = _("%s is already being used").format(this.accelerator_label);
            // Otherwise the set button
            } else {
                this.set_button.visible = true;
            }

            return true;
        }

        return true;
    }

    _onCancel() {
        return this.response(Gtk.ResponseType.CANCEL);
    }

    _onSet() {
        return this.response(Gtk.ResponseType.OK);
    }

    response(id) {
        this.hide();
        this.ungrab();
        Gtk.Dialog.prototype.response.call(this, id);

        return true;
    }

    check(accelerator) {
        // Check someone else isn't already using the binding
        let action = this.shell.GrabAccelerator(accelerator, 0);
//        let action = this.shell.call_sync(
//            "GrabAccelerator",
//            new GLib.Variant("(su)", [accelerator, 0]),
//            0,
//            -1,
//            null
//        ).deep_unpack()[0];

        if (action !== 0) {
            this.shell.UngrabAccelerator(action);
//            this.shell.call_sync(
//                "UngrabAccelerator",
//                new GLib.Variant("(u)", [action]),
//                0,
//                -1,
//                null
//            );
            return true;
        }

        return false;
    }

    grab() {
        let success = this.seat.grab(
            this.get_window(),
            Gdk.SeatCapabilities.KEYBOARD,
            true, // owner_events
            null, // cursor
            null, // event
            null
        );

        log("Seat Grab: " + success);

        if (success !== Gdk.GrabStatus.SUCCESS) {
            this._onCancel();
        }

        this._grabId = this.seat.get_keyboard();
        this._grabId = this._grabId || this.seat.get_pointer();
        this.grab_add();
    }

    ungrab() {
        this.seat.ungrab();
        this.grab_remove();
        delete this._grabId;
    }

    // A non-blocking version of run()
    run() {
        this.set_button.visible = false;

        this.show();

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this.grab();
            return false;
        });
    }
});

