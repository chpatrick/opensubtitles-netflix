import * as htmlparser from "htmlparser2";

interface Font {
  color?: string;
}

interface AssOverride {
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  size?: number;
};

const htmlEscapes: { [ char: string ]: string } = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;'
};

// convert even very malformed SRT/ASS to valid TTML
export function srtToTtml(srt: string) {
  // convert ASS commands to XML so we can process them with the SRT commands
  const assAsXml = srt.replace(/\{\\(.+?)\}/g,'<ass cmd="$1" />');

  const currentStyle = {
    fonts: <Font[]>[],
    italic: 0,
    bold: 0,
    underline: 0,
    strikethrough: 0
  };

  let openedSpan: null | string = null;

  let assOverride: AssOverride = {};

  let ttml = '';

  const parser = new htmlparser.Parser({
    onopentag: function(name, attribs){
      switch(name) {
        case 'i':
          currentStyle.italic++;
          break;

        case 'b':
          currentStyle.bold++;
          break;

        case 'u':
          currentStyle.underline++;
          break;

        case 's':
          currentStyle.strikethrough++;
          break;

        case 'font':
          const font: Font = {};
          if (attribs['color']) {
            font.color = attribs['color'];
          }
          // TODO: font size?

          currentStyle.fonts.push(font);
          break;

        case 'ass':
          if (!attribs['cmd']) {
            break;
          }
          switch (attribs['cmd']) {
            case 'b0':
              assOverride.bold = false;
              break;

            case 'b1':
              assOverride.bold = true;
              break;

            case 'i0':
              assOverride.italic = false;
              break;

            case 'i1':
              assOverride.italic = true;
              break;

            case 'u0':
              assOverride.underline = false;
              break;

            case 'u1':
              assOverride.underline = true;
              break;

            case 's0':
              assOverride.strikethrough = false;
              break;

            case 's1':
              assOverride.strikethrough = true;
              break;

            case 'r':
              assOverride = {};
              break;

            default:
              const match = /1?c&H([1-9a-fA-F]{0,6})&/.exec(attribs.cmd);
              if (match) {
                // this is a hexadecimal color code in BGR order, treated as a single number
                let colorCode = match[1];
                while (colorCode.length < 6) {
                  colorCode = '0' + colorCode;
                  assOverride.color = '#' + colorCode.slice(4, 6) + colorCode.slice(2, 4) + colorCode.slice(0, 2);
                }

              }
              break;

            // TODO: font size?
          }
          break;
      }
    },
    onclosetag: function(name){
      switch(name) {
        case 'i':
          currentStyle.italic = Math.max(currentStyle.italic - 1, 0);
          break;

        case 'b':
          currentStyle.bold = Math.max(currentStyle.bold - 1, 0);
          break;

        case 'u':
          currentStyle.underline = Math.max(currentStyle.underline - 1, 0);
          break;

        case 's':
          currentStyle.strikethrough = Math.max(currentStyle.strikethrough - 1, 0);
          break;

        case 'font':
          currentStyle.fonts.pop();
          // TODO: font size?
          break;
      }
    },
    ontext: function(text){
      let computedColor: string | null = null;
      if (assOverride.color) {
        computedColor = assOverride.color;
      }
      for (const font of currentStyle.fonts) {
        if (font.color) {
          computedColor = font.color;
          break;
        }
      }
      const computedStyle = {
        fontWeight: (assOverride.bold || currentStyle.bold > 0) ? "bold" : null,
        fontStyle: (assOverride.italic || currentStyle.italic > 0) ? "italic": null,
        // Netflix only supports one text decoration so if there are multiple, pick underline
        textDecoration: (assOverride.underline || currentStyle.underline > 0) ? "underline" : (assOverride.strikethrough || currentStyle.strikethrough > 0 ? "lineThrough" : null),
        color: computedColor
      };

      let newSpan: string | null = null;
      if (computedStyle.fontWeight || computedStyle.fontStyle || computedStyle.textDecoration || computedStyle.color) {
        newSpan = '<span';
        if (computedStyle.fontWeight) {
          newSpan += ` tts:fontWeight="${computedStyle.fontWeight}"`;
        }
        if (computedStyle.fontStyle) {
          newSpan += ` tts:fontStyle="${computedStyle.fontStyle}"`;
        }
        if (computedStyle.textDecoration) {
          newSpan += ` tts:textDecoration="${computedStyle.textDecoration}"`;
        }
        if (computedStyle.color) {
          newSpan += ` tts:color="${computedStyle.color}"`;
        }
        newSpan += '>';
      }

      if (newSpan !== openedSpan) {
        if (openedSpan) {
          ttml += '</span>';
        }
        if (newSpan) {
          ttml += newSpan;
        }
        openedSpan = newSpan;
      }

      ttml +=
        text
          .replace(/[&<>"'\/]/g, badChar => htmlEscapes[badChar])
          .split('\n')
          // netflix currently renders all loaded subtitles with direction="rtl", override this with the unicode control characters for each line
          .map(line => `&#x202a;${line}&#x202c;`)
          .join('<br/>')
    },
    }, {decodeEntities: false, xmlMode: true });

  parser.write(assAsXml);
  parser.end();

  if (openedSpan) {
    ttml += '</span>';
  }

  return ttml;
};
