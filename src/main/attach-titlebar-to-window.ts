/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AlexTorresSk. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export = (browserWindow: Electron.BrowserWindow) => {
    const sizes = browserWindow.getMinimumSize();
    let height = 270;

    if (sizes && sizes.length >= 1) {
        sizes.forEach(size => {
            console.log(size);
            if (sizes[1]) height = size;
        });
    }

    browserWindow.setMinimumSize(400, height);

    browserWindow.on("enter-full-screen", () => {
        browserWindow.webContents.send("window-fullscreen", true);
    });

    browserWindow.on("leave-full-screen", () => {
        browserWindow.webContents.send("window-fullscreen", false);
    });

    browserWindow.on("focus", () => {
        browserWindow.webContents.send("window-focus", true);
    });

    browserWindow.on("blur", () => {
        browserWindow.webContents.send("window-focus", false);
    });
};
