
# gnome-screenshot-ocr

A Gnome Shell extension that passes screenshots through an OCR engine and places the text on the clipboard. 

# Usage

To use, simply use the print screen key (or whatever shortcut currently takes screenshots). 

The screenshot will be saved as usual to both a *.png file and to the clipboard, but additionaly, any text appearing in the image and detected by the OCR will be copied onto the clipboard as well.

# Installation

Requires tesseract, which may be installed via `sudo apt install tesseract-ocr libtesseract-dev`

May be installed by running `gnome-extensions install --force screenshot-ocr.zip`
