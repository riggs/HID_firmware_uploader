var intel_hex = require("intel-hex");

var ui = {
    device_selector: null,
    connect: null,
    disconnect: null,
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
        selectedItem.connectionId = connectInfo.connectionId;
        logger("Connected to " + selectedItem + "on ID " + selectedItem.connectionId);
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
                    logger("Failed to load file.");
                    clearFileUI();
                    return;
                }

                upload_firmware(entry);
            });
        });
    });
};

function upload_firmware(file_data) {
    // Read in Intel-Hex text from file
    readAsText(file_data, function (text) {
        chrome.fileSystem.getDisplayPath(file_data, function (displayPath) {
            logger("Parsed " + displayPath);
        });
        var firmware = intel_hex.parse(text);
        var selectedItem = ui.device_selector.options[ui.device_selector.selectedIndex];
        var device = selectedItem.device;
        var connectionId = selectedItem.connectionId;
        var device_info = get_device_info(device.vendorId, device.productId);
        var report_data = new ArrayBuffer(8);

        // Write to report to trigger bootloader.
        chrome.hid.sendFeatureReport(connectionId, 255, report_data, () => {
            send_firmware_data(connectionId, device_info, 0, firmware.data);
        });
    });
}

function send_firmware_data(connectionId, device_info, address, data_Buffer) {
    if (address > data_Buffer.length) {
        chrome.hid.send(0, 0xFFFF, new ArrayBuffer(device_info.page_size), () => {
            logger("Firmware transmission finished.");
        });
        return;
    }
    // Bootloader page data should be the starting address to program,
    // then one device's flash page worth of data.
    var memory_page = new ArrayBuffer(2 + device_info.page_size);

    // Create a view that will address single bytes.
    var view = new Uint8Array(memory_page);

    // Devices with more than 64KB of flash should shift down the page
    // address so that it is 16-bit (page size is guaranteed to be
    // >= 256 bytes so no non-zero address bits are discarded)
    var page_address = device_info.flash_kb < 64 ? address : address >> 8;
    view[0] = page_address;
    view[1] = page_address >> 8;

    // Copy data from firmware Buffer into memory_page to send.
    for (var i=2; i < 2 + device_info.page_size; ++i) {
        view[i] = data_Buffer[address + i];
    }

    chrome.hid.send(connectionId, memory_page, () => {
        logger("Wrote page address " + address.toString(16));
        send_firmware_data(connectionId, device_info, address + device_info.page_size, data_Buffer);
    })
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
