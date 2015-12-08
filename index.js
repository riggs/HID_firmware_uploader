var intel_hex = require("intel-hex");

var ui = {
    device_selector: null,
    connect: null,
    disconnect: null,
    add_device: null,
    select_file: null,
    file_path: null,
    upload: null,
    log: null,
};

var connection = -1;

var initializeWindow = function () {
    for (var k in ui) {
        var element = document.getElementById(id);
        if (!element) {
            throw "Missing UI element: " + k;
        }
        ui[k] = element;
    }
    enableIOControls(false);
    ui.connect.addEventListener('click', onConnectClicked);
    ui.disconnect.addEventListener('click', onDisconnectClicked);
    ui.add_device.addEventListener('click', onAddDeviceClicked);
    ui.select_file.addEventListener('click', onSelectFileClicked);
    ui.upload.addEventListener('click', onUploadClicked);
    enumerateDevices();
};

var logger = function (message) {
    ui.log.textContent += (message + "\n");
    ui.log.scrollTop = ui.inputLog.scrollHeight;
};

var enableIOControls = function (ioEnabled) {
    ui.device_selector.disabled = ioEnabled;
    ui.connect.style.display = ioEnabled ? 'none' : 'inline';
    ui.disconnect.style.display = ioEnabled ? 'inline' : 'none';
};

var enumerateDevices = function () {
    chrome.hid.getDevices({}, onDevicesEnumerated);
    chrome.hid.onDeviceAdded.addListener(onDeviceAdded);
    chrome.hid.onDeviceRemoved.addListener(onDeviceRemoved);
};

var onDevicesEnumerated = function (devices) {
    if (chrome.runtime.lastError) {
        console.error("Unable to enumerate devices: " +
            chrome.runtime.lastError.message);
        return;
    }

    for (var device of devices) {
        onDeviceAdded(device);
    }
};

var onDeviceAdded = function (device) {
    var optionId = 'device-' + device.deviceId;
    if (ui.device_selector.namedItem(optionId)) {
        return;
    }

    var selectedIndex = ui.device_selector.selectedIndex;
    var option = document.createElement('option');
    option.text = "Device #" + device.deviceId + " [" +
        device.vendorId.toString(16) + ":" +
        device.productId.toString(16) + "]";
    option.id = optionId;
    option.device = device;
    ui.device_selector.options.add(option);
    if (selectedIndex != -1) {
        ui.device_selector.selectedIndex = selectedIndex;
    }
};

var onDeviceRemoved = function (deviceId) {
    var option = ui.device_selector.options.namedItem('device-' + deviceId);
    if (!option) {
        return;
    }

    if (option.selected) {
        onDisconnectClicked();
    }
    ui.device_selector.remove(option.index);
};

var onConnectClicked = function () {
    var selectedItem = ui.device_selector.options[ui.device_selector.selectedIndex];
    if (!selectedItem) {
        return;
    }
    var deviceId = parseInt(selectedItem.id.substr('device-'.length), 10);
    if (!deviceId) {
        return;
    }
    chrome.hid.connect(deviceId, function (connectInfo) {
        if (!connectInfo) {
            console.warn("Unable to connect to device.");
        }
        connection = connectInfo.connectionId;
        logger("Connected to " + selectedItem + "on ID " + connection);
        enableIOControls(true);
    });
};

var onDisconnectClicked = function () {
    if (connection === -1)
        return;
    chrome.hid.disconnect(connection, function () {
        connection = -1;
    });
    logger("Disconnected ID " + connection);
    enableIOControls(false);
};

var onAddDeviceClicked = function () {
    chrome.hid.getUserSelectedDevices({'multiple': false},
        function (devices) {
            if (chrome.runtime.lastError != undefined) {
                console.warn('chrome.hid.getUserSelectedDevices error: ' +
                    chrome.runtime.lastError.message);
                return;
            }
            for (var device of devices) {
                onDeviceAdded(device);
            }
        });
};

var clearFileUI = function () {
    ui.upload.disabled = true;
    ui.file_path.innerText = "";
};

var onSelectFileClicked = function () {
    clearFileUI();
    chrome.fileSystem.chooseEntry({accepts: [{extensions: "hex"}]}, function (entry) {
        if (!entry) {
            return;
        }
        ui.upload.disabled = false;

        chrome.fileSystem.getDisplayPath(entry, function (displayPath) {
            ui.file_path.innerText = displayPath;
        });

        // use local storage to retain access to this file
        chrome.storage.local.set({'chosenFile': chrome.fileSystem.retainEntry(entry)});
    });
};

var onUploadClicked = function () {
    chrome.storage.local.get('chosenFile', function (items) {
        if (items.chosenFile === undefined) {
            clearFileUI();
            return;
        }
        // if an entry was retained earlier, see if it can be restored
        chrome.fileSystem.isRestorable(items.chosenFile, function (bIsRestorable) {
            if (!bIsRestorable) {
                clearFileUI();
                return;
            }
            // the entry is still there, load the content
            chrome.fileSystem.restoreEntry(items.chosenFile, function (entry) {
                if (!entry) {
                    clearFileUI();
                    return;
                }
                upload_firmware(entry);
            });
        });
    });
};

function upload_firmware(file_entry) {
    readAsText(file_entry, function (text) {
        var firmware = intel_hex.parse(text);
        var device = ui.device_selector.options[ui.device_selector.selectedIndex].device;
        var device_info = get_device_info(device.vendorId, device.productId);

        // TODO: Trigger bootloader by writing to proper report.
        // TODO: Upload firmware file.
    });
}

function errorHandler(e) {
    console.error(e);
    clearFileUI();
}

function readAsText(file_entry, callback) {
    file_entry.file(function (file) {
        var reader = new FileReader();

        reader.onerror = errorHandler;
        reader.onload = function (e) {
            callback(e.target.result);
        };

        reader.readAsText(file);
    });
}

function get_device_info(vendorID, productID) {
    var device_info_map = {
        at90usb1287: {'page_size': 256, 'flash_kb': 128},
        at90usb1286: {'page_size': 256, 'flash_kb': 128},
        at90usb647 : {'page_size': 256, 'flash_kb': 64},
        at90usb646 : {'page_size': 256, 'flash_kb': 64},
        atmega32u4 : {'page_size': 128, 'flash_kb': 32},
        atmega32u2 : {'page_size': 128, 'flash_kb': 32},
        atmega16u4 : {'page_size': 128, 'flash_kb': 16},
        atmega16u2 : {'page_size': 128, 'flash_kb': 16},
        at90usb162 : {'page_size': 128, 'flash_kb': 16},
        atmega8u2  : {'page_size': 128, 'flash_kb': 8},
        at90usb82  : {'page_size': 128, 'flash_kb': 8},
    };
    return device_info_map['atmega32u4'];
}

window.addEventListener('load', initializeWindow);
