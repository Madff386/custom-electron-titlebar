/*--------------------------------------------------------------------------------------------------------
 *  This file has been modified by @AlexTorresSk (http://github.com/AlexTorresSk)
 *  to work in custom-electron-titlebar.
 *
 *  The original copy of this file and its respective license are in https://github.com/Microsoft/vscode/
 *
 *  Copyright (c) 2018 Alex Torres
 *  Licensed under the MIT License. See License in the project root for license information.
 *-------------------------------------------------------------------------------------------------------*/

import fs from 'fs';
import { Menu, ipcRenderer } from 'electron';
import { platform, PlatformToString, isLinux, isMacintosh, isWindows, isWeb, isIOS } from 'vs/base/common/platform';
import { Color, RGBA } from 'vs/base/common/color';
import { EventType, hide, show, append, $, addDisposableListener, prepend, Dimension } from 'vs/base/browser/dom';
//import { Menubar } from './menubar';
import { Direction } from 'vs/base/browser/ui/menu/menu';
import { TitlebarOptions } from './types/titlebar-options';
import defaultIcons from 'static/icons.json';
import titlebarTheme from 'static/titlebar.scss';
import { IMenuBarOptions, MenuBar } from 'vs/base/browser/ui/menu/menubar';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { RunOnceScheduler } from 'vs/base/common/async';
import { Action, IAction, Separator, SubmenuAction } from 'vs/base/common/actions';
import { BrowserFeatures } from 'vs/base/browser/canIUse';

const INACTIVE_FOREGROUND_DARK = Color.fromHex('#222222');
const ACTIVE_FOREGROUND_DARK = Color.fromHex('#333333');
const INACTIVE_FOREGROUND = Color.fromHex('#EEEEEE');
const ACTIVE_FOREGROUND = Color.fromHex('#FFFFFF');

const IS_MAC_BIGSUR_OR_LATER = isMacintosh && parseInt(process.getSystemVersion().split(".")[0]) >= 11;
const BOTTOM_TITLEBAR_HEIGHT = '60px';
const TOP_TITLEBAR_HEIGHT_MAC = IS_MAC_BIGSUR_OR_LATER ? '28px' : '22px';
const TOP_TITLEBAR_HEIGHT_WIN = '30px';

const MAX_WIN_WIDTH = 517

export default class Titlebar extends Disposable {
	_titlebar: HTMLElement;
	_dragRegion: HTMLElement;
	_windowIcon: HTMLImageElement;
	_title: HTMLElement;
	_menubarContainer: HTMLElement;
	_windowControls: HTMLElement;
	_container: HTMLElement;

	_isInactive?: boolean;
	_menubar?: MenuBar;
	_options: TitlebarOptions;

	_windowControlIcons: {
		minimize: HTMLElement,
		maximize: HTMLElement,
		close: HTMLElement,
	}

	_resizer: {
		top: HTMLElement;
		left: HTMLElement;
	};

	_defaultOptions: TitlebarOptions = {
		enableMnemonics: true,
		//hideWhenClickingClose: false,
		minimizable: true,
		maximizable: true,
		closeable: true,
	}

	_platformIcons: { [key: string]: string };

	private reinstallDisposables = this._register(new DisposableStore());

	private readonly _onVisibilityChange: Emitter<boolean>;
	private readonly _onFocusStateChange: Emitter<boolean>;

	private visible: boolean = true;
	private focusInsideMenubar: boolean = false;

	protected menuUpdater: RunOnceScheduler;

	constructor(titlebarOptions?: TitlebarOptions) {
		super();

		this._onVisibilityChange = this._register(new Emitter<boolean>());
		this._onFocusStateChange = this._register(new Emitter<boolean>());

		this._options = { ...this._defaultOptions, ...titlebarOptions };
		this._platformIcons = (defaultIcons as any)[PlatformToString(platform).toLocaleLowerCase()];

		this.menuUpdater = this._register(new RunOnceScheduler(() => this.doUpdateMenubar(false), 200));

		this._titlebar = $('div.cet-titlebar');
		this._dragRegion = $('div.cet-drag-region');
		this._windowIcon = $('div.cet-window-icon');
		this._menubarContainer = $('div.cet-menubar');
		this._title = $('div.cet-window-title');
		this._windowControls = $('div.cet-controls-container');
		this._container = $('div.cet-container');

		this._windowControlIcons = {
			minimize: $('div.cet-icon'),
			maximize: $('div.cet-icon'),
			close: $('div.cet-icon'),
		}

		this._resizer = {
			top: $('div.resizer.top'),
			left: $('div.resizer.left')
		}

		this._loadIcons();
		this._loadBackgroundColor();
		this._setupContainer();
		this._setupIcon();
		this._setupMenubar();
		this._setupTitle();
		this._createControls();
		this._setupTitlebar();
		this._updateStyles();
		this._loadEvents();
		this.registerListeners();

		(titlebarTheme as any).use();
	}

	_loadIcons() {
		if (this._options.icons) {
			const icons = fs.readFileSync(this._options.icons, 'utf8');
			const jsonIcons = JSON.parse(icons);
			this._platformIcons = jsonIcons[PlatformToString(platform).toLocaleLowerCase()];
		}
	}

	_loadBackgroundColor() {
		let color = Color.fromHex('#ffffff');

		if (!this._options.backgroundColor) {
			const nodeList: HTMLMetaElement[] = [].slice.call(document.getElementsByTagName("meta"));

			for (let node of nodeList) {
				if (node.name === "theme-color" || node.name === "msapplication-TileColor") {
					color = Color.fromHex(node.content || '#ffffff');
					break;
				}
			}

			this._options.backgroundColor = color;
		}
	}

	_setupTitlebar() {
		this._titlebar.classList.add(`cet-${PlatformToString(platform).toLocaleLowerCase()}`);

		if (this._options.order) this._titlebar.classList.add(`cet-${this._options.order}`);
		if (this._options.shadow) this._titlebar.classList.add('cet-shadow');

		if (IS_MAC_BIGSUR_OR_LATER) {
			this._title.classList.add('cet-bigsur');
			this._titlebar.style.height = TOP_TITLEBAR_HEIGHT_MAC;
		}

		prepend(document.body, this._titlebar);
	}

	_setupContainer() {
		// Remove margin to prevent double space between window and titlebar
		document.body.style.margin = '0';
		document.body.style.overflow = 'hidden';

		this._container.style.overflow = this._options.containerOverflow ?? 'auto';

		// Append to container all body elements
		while (document.body.firstChild) {
			append(this._container, document.body.firstChild);
		}

		append(document.body, this._container);
		append(this._titlebar, this._dragRegion);
		append(this._titlebar, this._resizer.left);
		append(this._titlebar, this._resizer.top);
	}

	_loadEvents() {
		this._onDidChangeMaximized();

		ipcRenderer.on('window-fullscreen', (_, isFullScreen) => this.onWindowFullScreen(isFullScreen));
		ipcRenderer.on('window-focus', (_, isFocused) => this.onWindowFocus(isFocused));

		if (isMacintosh) addDisposableListener(this._titlebar, EventType.DBLCLICK, () => {
			ipcRenderer.send('window-event', 'window-maximize');
			this._onDidChangeMaximized();
		});

		if (this._options.minimizable) addDisposableListener(this._windowControlIcons.minimize, EventType.CLICK, () => {
			ipcRenderer.send('window-event', 'window-minimize');
		});
		if (this._options.maximizable) addDisposableListener(this._windowControlIcons.maximize, EventType.CLICK, () => {
			ipcRenderer.send('window-event', 'window-maximize');
			this._onDidChangeMaximized();
		});

		if (this._options.closeable) addDisposableListener(this._windowControlIcons.close, EventType.CLICK, () => ipcRenderer.send('window-event', 'window-close'));
	}

	_closeMenu = () => {
		if (this._menubar) this._menubar.blur();
	}

	_setupIcon(): void {
		if (!isMacintosh) {
			if (!this._options.icon) {
				let favicon: string | undefined;
				const nodeList: HTMLLinkElement[] = [].slice.call(document.getElementsByTagName("link"));

				for (let node of nodeList) {
					if (node.rel === "icon" || node.rel === "shortcut icon") {
						favicon = node.href || undefined;
						break;
					}
				}

				this._options.icon = favicon;
			}

			const icon = append(this._windowIcon, $('img'));

			if (typeof this._options.icon === 'string') icon.setAttribute('src', `${this._options.icon}`);
			else icon.setAttribute('src', this._options.icon!.toDataURL());

			this._setIconSize(this._options.iconSize);

			append(this._titlebar, this._windowIcon);
		}
	}

	_setupMenubar() {
		if (this._options.menu) {
			this.updateMenu(this._options.menu);
		} else if (this._options.menu !== null) {
			ipcRenderer.invoke('request-application-menu').then(menu => this.updateMenu(menu));
		}

		this.updateMenuPosition(this._options.menuPosition ?? 'left');
		append(this._titlebar, this._menubarContainer);
	}

	_setupTitle() {
		this.updateTitle(document.title);
		this.updateTitleAlignment(this._options.titleHorizontalAlignment ?? 'center');
		append(this._titlebar, this._title);
	}

	_setIconSize(size?: number) {
		if (!size || size <= 16) size = 16;
		if (size >= 24) size = 24;
		this._windowIcon.firstElementChild!.setAttribute('height', `${size}px`);
	}

	_createControl(control: HTMLElement, enabled: boolean | undefined, title: string, icon: string, className: string) {
		control.title = title;
		control.innerHTML = icon;
		control.classList.add(className);
		if (!enabled) control.classList.add('inactive');
		append(this._windowControls, control);
	}

	_createControls() {
		if (!isMacintosh) {
			this._createControl(this._windowControlIcons.minimize, this._options.minimizable, "Minimize", this._platformIcons['minimize'], 'cet-window-minimize');
			this._createControl(this._windowControlIcons.maximize, this._options.maximizable, "Maximize", this._platformIcons['maximize'], 'cet-max-restore');
			this._createControl(this._windowControlIcons.close, this._options.closeable, "Close", this._platformIcons['close'], 'cet-window-close');

			append(this._titlebar, this._windowControls);
		}
	}

	_onBlur() {
		this._isInactive = true;
		this._updateStyles();
	}

	_onFocus() {
		this._isInactive = false;
		this._updateStyles();
	}

	_onMenubarVisibilityChanged(visible: boolean) {
		if (isWindows || isLinux) {
			if (visible) {
				// Hack to fix issue #52522 with layered webkit-app-region elements appearing under cursor
				hide(this._dragRegion);
				setTimeout(() => show(this._dragRegion), 50);
			}
		}
	}

	_onMenubarFocusChanged(focused: boolean) {
		if (isWindows || isLinux) {
			if (focused) hide(this._dragRegion);
			else show(this._dragRegion);
		}
	}

	_onDidChangeMaximized() {
		let isMaximized = ipcRenderer.sendSync('window-event', 'window-is-maximized');

		if (this._windowControlIcons.maximize) {
			this._windowControlIcons.maximize.title = isMaximized ? "Restore Down" : "Maximize";
			this._windowControlIcons.maximize.innerHTML = isMaximized ? this._platformIcons['restore'] : this._platformIcons['maximize'];
		}

		if (this._resizer) {
			if (isMaximized) hide(this._resizer.top, this._resizer.left);
			else show(this._resizer.top, this._resizer.left);
		}
	}

	_updateStyles() {
		if (this._isInactive) this._titlebar.classList.add('inactive');
		else this._titlebar.classList.remove('inactive');

		const titleBackground = this._isInactive
			? this._options.backgroundColor?.lighten(.15)
			: this._options.backgroundColor;

		if (titleBackground) this._titlebar.style.backgroundColor = titleBackground.toString();

		let titleForeground: Color;

		if (titleBackground?.isLighter()) {
			this._titlebar.classList.add('light');

			titleForeground = this._isInactive
				? INACTIVE_FOREGROUND_DARK
				: ACTIVE_FOREGROUND_DARK;
		} else {
			this._titlebar.classList.add('light');

			titleForeground = this._isInactive
				? INACTIVE_FOREGROUND
				: ACTIVE_FOREGROUND;
		}

		this._titlebar.style.color = titleForeground.toString();

		const backgroundColor = this._options.backgroundColor?.darken(.16);

		const foregroundColor = backgroundColor?.isLighter()
			? INACTIVE_FOREGROUND_DARK
			: INACTIVE_FOREGROUND;

		const bgColor = !this._options.itemBackgroundColor || this._options.itemBackgroundColor.equals(backgroundColor!)
			? new Color(new RGBA(0, 0, 0, .12))
			: this._options.itemBackgroundColor;

		const fgColor = bgColor.isLighter() ? ACTIVE_FOREGROUND_DARK : ACTIVE_FOREGROUND;

		if (this._menubar) {
			this._menubar.style({
				backgroundColor: backgroundColor,
				foregroundColor: foregroundColor,
				selectionBackgroundColor: bgColor,
				selectionForegroundColor: fgColor,
				separatorColor: foregroundColor
			});
		}
	}

	protected doUpdateMenubar(firstTime: boolean): void {
		this.updateMenu(this._options.menu!, firstTime);
	}

	/**
	 * Update title bar styles based on focus state.
	 * @param hasFocus focus state of the window 
	 */
	public onWindowFocus(focus: boolean): void {
		if (this._titlebar) {
			if (focus) {
				this._titlebar.classList.remove('inactive');
				this._onFocus();
			} else {
				this._titlebar.classList.add('inactive');
				this._closeMenu();
				this._onBlur();
			}
		}
	}

	/**
	 * Update the full screen state and hide or show the title bar.
	 * @param fullscreen Fullscreen state of the window
	 */
	public onWindowFullScreen(fullscreen: boolean): void {
		if (!isMacintosh) {
			if (fullscreen) {
				hide(this._titlebar);
				this._container.style.top = '0px';
			} else {
				show(this._titlebar);
				if (this._options.menuPosition === 'bottom') this._container.style.top = BOTTOM_TITLEBAR_HEIGHT;
				else this._container.style.top = isMacintosh ? TOP_TITLEBAR_HEIGHT_MAC : TOP_TITLEBAR_HEIGHT_WIN;
			}
		}
	}


	/**
	 * Update the background color of the title bar
	 * @param backgroundColor The color for the background 
	 */
	public updateBackground(backgroundColor: Color): Titlebar {
		this._options.backgroundColor = backgroundColor;
		this._updateStyles();

		return this;
	}

	/**
	 * Update the item background color of the menubar
	 * @param itemBGColor The color for the item background
	 */
	public updateItemBGColor(itemBGColor: Color): Titlebar {
		this._options.itemBackgroundColor = itemBGColor;
		this._updateStyles();

		return this;
	}

	/**
	 * Update the title of the title bar.
	 * You can use this method if change the content of `<title>` tag on your html.
	 * @param title The title of the title bar and document.
	 */
	public updateTitle(title: string): void {
		if (this._title) {
			document.title = title;
			this._title.innerText = title;
		}
	}

	/**
	 * It method set new icon to title-bar-icon of title-bar.
	 * @param path path to icon
	 */
	public updateIcon(path?: string): void {
		if (!path) return;
		if (this._windowIcon) this._windowIcon.src = path;
	}

	/**
	 * Update the default menu or set a new menu.
	 * @param menu The menu.
	 */
	public updateMenu(menu: Menu, firstTime = true): Titlebar {
		if (!isMacintosh) {
			if (this._menubar) this._menubar.dispose();
			if (menu) this._options.menu = menu;

			if (firstTime) {
				// Reset and create new menubar
				if (this._menubar) {
					this.reinstallDisposables.clear();
				}

				this._menubar = this.reinstallDisposables.add(new MenuBar(this._menubarContainer, this.getMenuBarOptions()));

				this.reinstallDisposables.add(this._menubar.onFocusStateChange(focused => {
					this._onFocusStateChange.fire(focused);

					// When the menubar loses focus, update it to clear any pending updates
					if (!focused) {
						this.updateMenubar();
						this.focusInsideMenubar = false;
					}
				}));

				this.reinstallDisposables.add(this._menubar.onVisibilityChange(e => this.onDidVisibilityChange(e)));

				// Before we focus the menubar, stop updates to it so that focus-related context keys will work
				this.reinstallDisposables.add(addDisposableListener(this._menubarContainer, EventType.FOCUS_IN, () => {
					this.focusInsideMenubar = true;
				}));

				this.reinstallDisposables.add(addDisposableListener(this._menubarContainer, EventType.FOCUS_OUT, () => {
					this.focusInsideMenubar = false;
				}));
			} else {
				this._menubar?.update(this.getMenuBarOptions());
			}

			// Update the menu actions
			const updateActions = (menu: Menu, target: IAction[], topLevelTitle: string) => {
				target.splice(0);
				let actions = menu.items;

				for (let action of actions) {
					if (action.submenu) {
						let submenu = action.submenu;

						if (submenu) {
							const submenuActions: SubmenuAction[] = [];
							updateActions(submenu, submenuActions, topLevelTitle);

							if (submenuActions.length > 0) {
								target.push(new SubmenuAction('', mnemonicMenuLabel(action.label), submenuActions));
							}
						}
					} else {
						const newAction = new Action(action.id, mnemonicMenuLabel(action.label), '', action.enabled, () => action.click);
						newAction.tooltip = action.toolTip;
						newAction.checked = action.checked;
						target.push(newAction);
					}

				}

				target.pop();
			};

			for (let item of menu.items) {
				if (this._menubar) {
					const actions: IAction[] = [];
					if (menu) {
						updateActions(menu, actions, item.label);
					}

					if (!firstTime) {
						this._menubar.updateMenu({ actions: actions, label: mnemonicMenuLabel(item.label) });
					} else {
						this._menubar.push({ actions: actions, label: mnemonicMenuLabel(item.label) });
					}
				}
			}

			/*this._menubar = new MenuBar(this._menubarContainer, this._options);
			this._menubar.setupMenubar();

			this._menubar.onVisibilityChange(e => this._onMenubarVisibilityChanged(e));
			this._menubar.onFocusStateChange(e => this._onMenubarFocusChanged(e));*/

			this._updateStyles();
		}

		return this;
	}

	private getMenuBarOptions(): IMenuBarOptions {
		console.log(this._options.menuPosition === 'right' ? Direction.Left : Direction.Right);
		
		return {
			enableMnemonics: this._options.enableMnemonics,
			//disableAltFocus: this.currentDisableMenuBarAltFocus,
			//visibility: true,
			//actionRunner: this.actionRunner,
			//getKeybinding: (action) => this.keybindingService.lookupKeybinding(action.id),
			alwaysOnMnemonics: true,
			compactMode: this._options.menuPosition === 'right' ? Direction.Left : Direction.Right,
			getCompactMenuActions: () => {
				if (!isWeb) {
					return []; // only for web
				}

				return [];
			}
		};
	}

	private updateMenubar(): void {
		this.menuUpdater.schedule();
	}

	private onDidVisibilityChange(visible: boolean): void {
		this.visible = visible;
		this._onVisibilityChange.fire(visible);
	}

	/**
	 * Update the menu from Menu.getApplicationMenu()
	 */
	public async refreshMenu(): Promise<void> {
		if (!isMacintosh) ipcRenderer.invoke('request-application-menu').then(menu => this.updateMenu(menu));
	}

	/**
	 * Update the position of menubar.
	 * @param menuPosition The position of the menu `left`, `right` or `bottom`.
	 */
	public updateMenuPosition(menuPosition: "left" | "right" | "bottom"): Titlebar {
		const height = isMacintosh ? TOP_TITLEBAR_HEIGHT_MAC : TOP_TITLEBAR_HEIGHT_WIN;

		this._titlebar.style.height = menuPosition === 'bottom' ? BOTTOM_TITLEBAR_HEIGHT : height;
		this._container.style.top = menuPosition === 'bottom' ? BOTTOM_TITLEBAR_HEIGHT : height;

		if (menuPosition === 'bottom') this._menubarContainer.classList.add('bottom');
		else if (menuPosition === 'right') this._menubarContainer.classList.add('right');
		else {
			this._menubarContainer.classList.remove('right');
			this._menubarContainer.classList.remove('bottom');
		}

		this._options.menuPosition = menuPosition;

		return this;
	}

	/**
	 * Horizontal alignment of the title.
	 * @param side `left`, `center` or `right`.
	 */
	public updateTitleAlignment(side: "left" | "center" | "right"): Titlebar {
		if (side === 'left' || (side === 'right' && this._options.order === 'inverted')) {
			this._title.style.marginLeft = '8px';
			this._title.style.marginRight = 'auto';
		}

		if (side === 'right' || (side === 'left' && this._options.order === 'inverted')) {
			this._title.style.marginRight = '8px';
			this._title.style.marginLeft = 'auto';
		}

		if (side === 'center' || side === undefined) {
			if (this._options.menuPosition !== 'bottom') {
				addDisposableListener(window, 'resize', () => {
					if (window.innerWidth >= 1188) {
						this._title.style.position = 'absolute';
						this._title.style.left = '50%';
						this._title.style.transform = 'translate(-50%, 0px)';
					} else {
						this._title.style.position = '';
						this._title.style.left = '';
						this._title.style.transform = '';
					}
				});
			}

			if (!isMacintosh && this._options.order !== 'first-buttons') this._windowControls.style.marginLeft = 'auto';
			this._title.style.maxWidth = 'calc(100vw - 296px)';
		}

		return this;
	}

	protected adjustTitleMarginToCenter(): void {
		if (this._menubarContainer) {
			const leftMarker = (this._windowIcon ? this._windowIcon.clientWidth : 0) + this._menubarContainer.clientWidth + 10;
			const rightMarker = this._titlebar.clientWidth - 10;

			// Not enough space to center the titlebar within window,
			// Center between menu and window controls
			if (leftMarker > (this._titlebar.clientWidth - this._title.clientWidth) / 2 ||
				rightMarker < (this._titlebar.clientWidth + this._title.clientWidth) / 2) {
				this._title.style.position = '';
				this._title.style.left = '';
				this._title.style.transform = '';
				return;
			}
		}

		this._title.style.position = 'absolute';
		this._title.style.left = '50%';
		this._title.style.transform = 'translate(-50%, 0)';
	}

	/**
	 * Remove the titlebar, menubar and all methods.
	 */
	public dispose(): void {
		if (this._menubar) this._menubar.dispose();
		this._titlebar.remove();
		while (this._container.firstChild) append(document.body, this._container.firstChild);
		this._container.remove();
	}

	get onVisibilityChange(): Event<boolean> {
		return this._onVisibilityChange.event;
	}

	get onFocusStateChange(): Event<boolean> {
		return this._onFocusStateChange.event;
	}

	registerListeners(): void {
		this._register(addDisposableListener(window, EventType.RESIZE, () => {
			if (this._menubar && !(isIOS && BrowserFeatures.pointerEvents)) {
				this._menubar.blur();
			}
		}));
	}

	getMenubarItemsDimensions(): Dimension {
		if (this._menubar) {
			return new Dimension(this._menubar.getWidth(), this._menubar.getHeight());
		}

		return new Dimension(0, 0);
	}
}

/**
 * Handles mnemonics for menu items. Depending on OS:
 * - Windows: Supported via & character (replace && with &)
 * -   Linux: Supported via & character (replace && with &)
 * -   macOS: Unsupported (replace && with empty string)
 */
export function mnemonicMenuLabel(label: string, forceDisableMnemonics?: boolean): string {
	if (isMacintosh || forceDisableMnemonics) {
		return label.replace(/\(&&\w\)|&&/g, '').replace(/&/g, isMacintosh ? '&' : '&&');
	}

	return label.replace(/&&|&/g, m => m === '&' ? '&&' : '&');
}