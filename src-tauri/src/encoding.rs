//! Text encodings: decoding what a file contains and encoding what a save writes.
//!
//! Reading: a byte order mark decides first (UTF-8, UTF-16 LE, UTF-16 BE); valid UTF-8
//! without a mark is `utf-8`; anything else goes to `chardetng`, which picks a legacy encoding
//! that `encoding_rs` decodes. Bytes that cannot be decoded become U+FFFD and set `lossy`.
//!
//! Saving writes the document in the encoding it was read in, except that a legacy-encoded
//! document is saved as `utf-8` (the frontend tells the user once, when the file is opened).

use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use serde::{Deserialize, Serialize};

const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
const UTF16LE_BOM: [u8; 2] = [0xFF, 0xFE];
const UTF16BE_BOM: [u8; 2] = [0xFE, 0xFF];

/// `Encoding` in `src/lib/platform.ts`: how a document is saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Encoding {
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-8-bom")]
    Utf8Bom,
    #[serde(rename = "utf-16le")]
    Utf16Le,
    #[serde(rename = "utf-16be")]
    Utf16Be,
}

/// The result of decoding a file. The text still has the file's own line endings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decoded {
    pub text: String,
    /// How the document will be saved. Always `Utf8` for a legacy-encoded file.
    pub encoding: Encoding,
    /// The name of the legacy encoding the bytes were decoded with, such as `windows-1252`.
    pub legacy_encoding: Option<String>,
    /// Some bytes could not be decoded and were replaced by U+FFFD.
    pub lossy: bool,
}

/// Decodes the bytes of a file.
pub fn decode(bytes: &[u8]) -> Decoded {
    if let Some(rest) = bytes.strip_prefix(&UTF8_BOM) {
        let (text, lossy) = decode_with(encoding_rs::UTF_8, rest);
        return Decoded {
            text,
            encoding: Encoding::Utf8Bom,
            legacy_encoding: None,
            lossy,
        };
    }
    if let Some(rest) = bytes.strip_prefix(&UTF16LE_BOM) {
        let (text, lossy) = decode_with(encoding_rs::UTF_16LE, rest);
        return Decoded {
            text,
            encoding: Encoding::Utf16Le,
            legacy_encoding: None,
            lossy,
        };
    }
    if let Some(rest) = bytes.strip_prefix(&UTF16BE_BOM) {
        let (text, lossy) = decode_with(encoding_rs::UTF_16BE, rest);
        return Decoded {
            text,
            encoding: Encoding::Utf16Be,
            legacy_encoding: None,
            lossy,
        };
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Decoded {
            text: text.to_owned(),
            encoding: Encoding::Utf8,
            legacy_encoding: None,
            lossy: false,
        },
        Err(_) => decode_legacy(bytes),
    }
}

fn decode_with(encoding: &'static encoding_rs::Encoding, bytes: &[u8]) -> (String, bool) {
    let (text, had_errors) = encoding.decode_without_bom_handling(bytes);
    (text.into_owned(), had_errors)
}

/// Bytes that are not valid UTF-8 and carry no byte order mark: guess a legacy encoding.
fn decode_legacy(bytes: &[u8]) -> Decoded {
    let mut detector = EncodingDetector::new(Iso2022JpDetection::Deny);
    detector.feed(bytes, true);
    let guess = prefer_windows_1252(bytes, detector.guess(None, Utf8Detection::Deny));
    let (text, lossy) = decode_with(guess, bytes);
    Decoded {
        text,
        encoding: Encoding::Utf8,
        legacy_encoding: Some(guess.name().to_owned()),
        lossy,
    }
}

/// A file with this many non-ASCII bytes or fewer is too short for `chardetng` to tell the Latin
/// code pages apart.
const THIN_EVIDENCE_BYTES: usize = 8;

/// Latin code pages that `chardetng` may pick instead of windows-1252 when it has little to go on.
fn is_other_latin_code_page(encoding: &'static encoding_rs::Encoding) -> bool {
    [
        encoding_rs::WINDOWS_1250,
        encoding_rs::ISO_8859_2,
        encoding_rs::ISO_8859_4,
        encoding_rs::ISO_8859_13,
        encoding_rs::WINDOWS_1254,
        encoding_rs::WINDOWS_1257,
        encoding_rs::WINDOWS_1258,
    ]
    .contains(&encoding)
}

/// `chardetng` is built for web pages and has no preference among the Latin code pages when a
/// file has only a few non-ASCII bytes: for "Hello \xFFWorld" it answers windows-1250. Legacy
/// Markdown files are overwhelmingly Western "ANSI" files from Windows, so in that case
/// windows-1252 wins, unless the bytes contain one of the five that windows-1252 leaves
/// undefined. A file with enough non-ASCII bytes keeps whatever `chardetng` decided, so Polish
/// or Turkish text is still detected as such.
fn prefer_windows_1252(
    bytes: &[u8],
    guess: &'static encoding_rs::Encoding,
) -> &'static encoding_rs::Encoding {
    if !is_other_latin_code_page(guess) {
        return guess;
    }
    let non_ascii = bytes.iter().filter(|byte| **byte >= 0x80).count();
    let undefined_in_windows_1252 = bytes
        .iter()
        .any(|byte| matches!(*byte, 0x81 | 0x8D | 0x8F | 0x90 | 0x9D));
    if non_ascii <= THIN_EVIDENCE_BYTES && !undefined_in_windows_1252 {
        encoding_rs::WINDOWS_1252
    } else {
        guess
    }
}

/// The bytes a save writes for `text` (which already has its final line endings).
pub fn encode(text: &str, encoding: Encoding) -> Vec<u8> {
    match encoding {
        Encoding::Utf8 => text.as_bytes().to_vec(),
        Encoding::Utf8Bom => {
            let mut out = Vec::with_capacity(UTF8_BOM.len() + text.len());
            out.extend_from_slice(&UTF8_BOM);
            out.extend_from_slice(text.as_bytes());
            out
        }
        Encoding::Utf16Le => {
            let mut out = Vec::with_capacity(UTF16LE_BOM.len() + text.len() * 2);
            out.extend_from_slice(&UTF16LE_BOM);
            out.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
            out
        }
        Encoding::Utf16Be => {
            let mut out = Vec::with_capacity(UTF16BE_BOM.len() + text.len() * 2);
            out.extend_from_slice(&UTF16BE_BOM);
            out.extend(text.encode_utf16().flat_map(u16::to_be_bytes));
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(text: &str, bom: &[u8], to_bytes: fn(u16) -> [u8; 2]) -> Vec<u8> {
        let mut bytes = bom.to_vec();
        bytes.extend(text.encode_utf16().flat_map(to_bytes));
        bytes
    }

    #[test]
    fn plain_utf8_is_utf8_without_a_legacy_name() {
        let decoded = decode("héllo € 快速\n".as_bytes());

        assert_eq!(decoded.text, "héllo € 快速\n");
        assert_eq!(decoded.encoding, Encoding::Utf8);
        assert_eq!(decoded.legacy_encoding, None);
        assert!(!decoded.lossy);
    }

    #[test]
    fn ascii_and_empty_input_are_utf8() {
        for bytes in [&b""[..], b"plain ascii\n"] {
            let decoded = decode(bytes);
            assert_eq!(decoded.encoding, Encoding::Utf8);
            assert_eq!(decoded.text.as_bytes(), bytes);
            assert!(!decoded.lossy);
        }
    }

    #[test]
    fn a_utf8_byte_order_mark_is_removed_and_remembered() {
        let decoded = decode(b"\xEF\xBB\xBFhello");

        assert_eq!(decoded.text, "hello");
        assert_eq!(decoded.encoding, Encoding::Utf8Bom);
        assert!(!decoded.lossy);
    }

    #[test]
    fn a_file_with_only_a_utf8_byte_order_mark_is_empty_text() {
        let decoded = decode(b"\xEF\xBB\xBF");

        assert_eq!(decoded.text, "");
        assert_eq!(decoded.encoding, Encoding::Utf8Bom);
    }

    #[test]
    fn utf16_with_a_byte_order_mark_is_decoded_in_both_orders() {
        let le = decode(&utf16("Hello é 快速\n", &UTF16LE_BOM, u16::to_le_bytes));
        let be = decode(&utf16("Hello é 快速\n", &UTF16BE_BOM, u16::to_be_bytes));

        assert_eq!(
            (le.text.as_str(), le.encoding),
            ("Hello é 快速\n", Encoding::Utf16Le)
        );
        assert_eq!(
            (be.text.as_str(), be.encoding),
            ("Hello é 快速\n", Encoding::Utf16Be)
        );
        assert!(!le.lossy && !be.lossy);
        assert_eq!(le.legacy_encoding, None);
    }

    #[test]
    fn utf16_decodes_characters_outside_the_basic_plane() {
        let decoded = decode(&utf16("a 👨‍👩‍👧‍👦 b", &UTF16LE_BOM, u16::to_le_bytes));

        assert_eq!(decoded.text, "a 👨‍👩‍👧‍👦 b");
        assert!(!decoded.lossy);
    }

    #[test]
    fn utf16_with_a_lone_surrogate_or_a_cut_off_last_byte_is_lossy() {
        let mut lone_surrogate = UTF16LE_BOM.to_vec();
        lone_surrogate.extend_from_slice(&[0x41, 0x00, 0x00, 0xD8, 0x42, 0x00]);
        let mut cut_off = UTF16BE_BOM.to_vec();
        cut_off.extend_from_slice(&[0x00, 0x41, 0x00]);

        let first = decode(&lone_surrogate);
        let second = decode(&cut_off);

        assert_eq!(first.text, "A\u{fffd}B");
        assert!(first.lossy);
        assert_eq!(second.text, "A\u{fffd}");
        assert!(second.lossy);
    }

    #[test]
    fn invalid_utf8_after_a_utf8_byte_order_mark_is_lossy_not_legacy() {
        // The mark says UTF-8, so no other encoding is tried.
        let decoded = decode(b"\xEF\xBB\xBFcaf\xE9 au lait");

        assert_eq!(decoded.text, "caf\u{fffd} au lait");
        assert_eq!(decoded.encoding, Encoding::Utf8Bom);
        assert_eq!(decoded.legacy_encoding, None);
        assert!(decoded.lossy);
    }

    #[test]
    fn windows_1252_text_is_detected_and_decoded() {
        // "café\nnaïve\n€ 5\n’ text" in windows-1252 (the euro sign is 0x80, the quote 0x92).
        let bytes = b"caf\xE9\nna\xEFve\n\x80 5\n\x92 text";

        let decoded = decode(bytes);

        assert_eq!(decoded.text, "café\nnaïve\n€ 5\n’ text");
        assert_eq!(decoded.encoding, Encoding::Utf8);
        assert_eq!(decoded.legacy_encoding.as_deref(), Some("windows-1252"));
        assert!(!decoded.lossy);
    }

    #[test]
    fn invalid_utf8_with_no_mark_goes_to_a_legacy_encoding() {
        let decoded = decode(b"Hello \xFFWorld \xC3(!");

        assert_eq!(decoded.encoding, Encoding::Utf8);
        assert_eq!(decoded.legacy_encoding.as_deref(), Some("windows-1252"));
        assert_eq!(decoded.text, "Hello ÿWorld Ã(!");
        assert!(!decoded.lossy);
    }

    #[test]
    fn a_few_non_ascii_bytes_are_not_enough_to_leave_windows_1252() {
        // chardetng alone answers windows-1250 for this input (see prefer_windows_1252).
        let mut detector = EncodingDetector::new(Iso2022JpDetection::Deny);
        detector.feed(b"Hello \xFFWorld \xC3(!", true);
        let raw_guess = detector.guess(None, Utf8Detection::Deny);

        assert_eq!(raw_guess.name(), "windows-1250");
        assert_eq!(
            prefer_windows_1252(b"Hello \xFFWorld \xC3(!", raw_guess),
            encoding_rs::WINDOWS_1252
        );
    }

    #[test]
    fn the_bias_only_applies_to_other_latin_code_pages_and_to_thin_evidence() {
        let thin = b"caf\xE9";
        let many: Vec<u8> = std::iter::repeat_n(0xE9u8, THIN_EVIDENCE_BYTES + 1).collect();

        // Enough evidence: the guess stands.
        assert_eq!(
            prefer_windows_1252(&many, encoding_rs::WINDOWS_1250),
            encoding_rs::WINDOWS_1250
        );
        // A byte that windows-1252 leaves undefined: the guess stands.
        assert_eq!(
            prefer_windows_1252(b"a\x81b", encoding_rs::WINDOWS_1250),
            encoding_rs::WINDOWS_1250
        );
        // Not a Latin code page: never touched, however little there is.
        assert_eq!(
            prefer_windows_1252(thin, encoding_rs::SHIFT_JIS),
            encoding_rs::SHIFT_JIS
        );
        assert_eq!(
            prefer_windows_1252(thin, encoding_rs::WINDOWS_1251),
            encoding_rs::WINDOWS_1251
        );
        // Thin evidence for another Latin code page: windows-1252.
        for other in [
            encoding_rs::WINDOWS_1250,
            encoding_rs::ISO_8859_2,
            encoding_rs::ISO_8859_4,
            encoding_rs::ISO_8859_13,
            encoding_rs::WINDOWS_1254,
            encoding_rs::WINDOWS_1257,
            encoding_rs::WINDOWS_1258,
        ] {
            assert_eq!(prefer_windows_1252(thin, other), encoding_rs::WINDOWS_1252);
        }
    }

    #[test]
    fn a_long_central_european_text_is_still_detected_as_one() {
        let text = "Zażółć gęślą jaźń. Pchnąć w tę łódź jeża lub ośm skrzyń fig. \
                    Chrząszcz brzmi w trzcinie w Szczebrzeszynie. Mężny bądź chroń pułk twój \
                    i sześć flag. Dość gróźb fuzją, klnę, pych i małżeństw! Stróż pchnął kość \
                    w quiz gędźb vel fax myjń.\n";
        let (bytes, _, had_errors) = encoding_rs::WINDOWS_1250.encode(text);
        assert!(!had_errors);

        let decoded = decode(&bytes);

        let name = decoded.legacy_encoding.expect("a legacy encoding");
        assert!(
            name == "windows-1250" || name == "ISO-8859-2",
            "Polish text keeps its own code page, got {name}"
        );
        assert_eq!(decoded.encoding, Encoding::Utf8);
    }

    #[test]
    fn a_legacy_encoding_with_unmapped_bytes_is_lossy() {
        // 0x81 is not a valid single byte in Shift_JIS, 0x20 follows it.
        let decoded = decode_with(encoding_rs::SHIFT_JIS, b"ab\x81\x20cd");

        assert!(decoded.1);
        assert!(decoded.0.contains('\u{fffd}'));
    }

    #[test]
    fn a_japanese_file_in_shift_jis_is_detected() {
        let (bytes, _, had_errors) = encoding_rs::SHIFT_JIS
            .encode("これは日本語の文章です。ファイルはShift_JISで保存されています。\n");
        assert!(!had_errors);

        let decoded = decode(&bytes);

        assert_eq!(decoded.encoding, Encoding::Utf8);
        assert_eq!(decoded.legacy_encoding.as_deref(), Some("Shift_JIS"));
        assert_eq!(
            decoded.text,
            "これは日本語の文章です。ファイルはShift_JISで保存されています。\n"
        );
        assert!(!decoded.lossy);
    }

    #[test]
    fn encode_writes_each_encoding_with_its_byte_order_mark() {
        assert_eq!(encode("é\n", Encoding::Utf8), b"\xC3\xA9\n");
        assert_eq!(encode("é\n", Encoding::Utf8Bom), b"\xEF\xBB\xBF\xC3\xA9\n");
        assert_eq!(encode("é\n", Encoding::Utf16Le), b"\xFF\xFE\xE9\x00\n\x00");
        assert_eq!(encode("é\n", Encoding::Utf16Be), b"\xFE\xFF\x00\xE9\x00\n");
    }

    #[test]
    fn encode_writes_surrogate_pairs_for_characters_outside_the_basic_plane() {
        // U+1F600 is the pair D83D DE00.
        assert_eq!(
            encode("\u{1F600}", Encoding::Utf16Le),
            b"\xFF\xFE\x3D\xD8\x00\xDE"
        );
        assert_eq!(
            encode("\u{1F600}", Encoding::Utf16Be),
            b"\xFE\xFF\xD8\x3D\xDE\x00"
        );
    }

    #[test]
    fn encoding_then_decoding_restores_the_text_in_every_encoding() {
        let text = "Line 1\nquick brown fox\n快速的棕色狐狸\nالثعلب\n👨‍👩‍👧‍👦\n";
        for encoding in [
            Encoding::Utf8,
            Encoding::Utf8Bom,
            Encoding::Utf16Le,
            Encoding::Utf16Be,
        ] {
            let decoded = decode(&encode(text, encoding));

            assert_eq!(decoded.text, text, "{encoding:?}");
            assert_eq!(decoded.encoding, encoding);
            assert!(!decoded.lossy);
        }
    }

    #[test]
    fn encodings_serialize_with_the_names_the_frontend_uses() {
        let names = [
            (Encoding::Utf8, "utf-8"),
            (Encoding::Utf8Bom, "utf-8-bom"),
            (Encoding::Utf16Le, "utf-16le"),
            (Encoding::Utf16Be, "utf-16be"),
        ];
        for (encoding, name) in names {
            assert_eq!(
                serde_json::to_value(encoding).expect("serializes"),
                serde_json::json!(name)
            );
            let parsed: Encoding = serde_json::from_value(serde_json::json!(name)).expect("parses");
            assert_eq!(parsed, encoding);
        }
    }
}
