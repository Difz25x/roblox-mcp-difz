/**
 * strip-comments.js — removes all TypeScript comments from .ts files.
 * Handles nested template literals, string literals, regex literals, and shebang.
 */
const fs = require('fs');
const path = require('path');
const SRC_DIR = path.resolve(__dirname, '..', 'src');

function stripComments(code) {
    const len = code.length;
    const out = [];
    let i = 0;

    while (i < len) {
        const ch = code[i];
        const next = i + 1 < len ? code[i + 1] : '';

        // 1. Shebang
        if (ch === '#' && next === '!' && i === 0) {
            let end = code.indexOf('\n', i);
            if (end === -1) end = len;
            out.push(code.slice(i, end));
            i = end;
            continue;
        }

        // 2. Template literal with nested ${} support
        if (ch === '`') {
            i = parseTemplate(code, i, out);
            continue;
        }

        // 3. String literals
        if (ch === '"' || ch === "'") {
            i = parseString(code, i, out);
            continue;
        }

        // 4. Single-line comment
        if (ch === '/' && next === '/') {
            let end = code.indexOf('\n', i + 2);
            if (end === -1) end = len;
            i = end;
            continue;
        }

        // 5. Multi-line comment
        if (ch === '/' && next === '*') {
            let end = code.indexOf('*/', i + 2);
            if (end === -1) end = len - 2;
            i = end + 2;
            continue;
        }

        // 6. Regex literal (heuristic)
        if (ch === '/' && i > 0) {
            const prev = prevNonWs(code, i);
            if (prev !== null && /[=(\\[!&|:;,?~^*/%+-]/.test(prev)) {
                i = parseRegex(code, i, out);
                continue;
            }
        }

        out.push(ch);
        i++;
    }
    return out.join('');
}

function parseString(code, i, out) {
    const q = code[i];
    out.push(q);
    i++;
    while (i < code.length) {
        const c = code[i];
        if (c === '\\') { out.push(code[i], code[i+1]||''); i += 2; continue; }
        if (c === q) { out.push(c); i++; break; }
        out.push(c);
        i++;
    }
    return i;
}

function parseTemplate(code, i, out) {
    out.push('`');
    i++;
    let depth = 0;
    while (i < code.length) {
        const c = code[i];
        const n = i + 1 < code.length ? code[i + 1] : '';
        if (c === '\\') { out.push(code[i], code[i+1]||''); i += 2; continue; }

        // Start template expression
        if (c === '$' && n === '{') {
            depth++;
            out.push('${');
            i += 2;
            let bd = 1;
            while (i < code.length && bd > 0) {
                const cc = code[i];
                const nn = i + 1 < code.length ? code[i + 1] : '';
                if (cc === '\\') { out.push(code[i], code[i+1]||''); i += 2; continue; }
                if (cc === '`') { i = parseTemplate(code, i, out); continue; }
                if (cc === '$' && nn === '{') { bd++; out.push('${'); i += 2; continue; }
                if (cc === '}') { bd--; if (bd === 0) { out.push('}'); i++; break; } }
                if (cc === '"' || cc === "'") { i = parseString(code, i, out); continue; }
                if (cc === '/' && nn === '/') { i = code.indexOf('\n', i+2); if (i===-1) i=code.length; continue; }
                if (cc === '/' && nn === '*') { let e = code.indexOf('*/', i+2); i = (e===-1?code.length-2:e)+2; continue; }
                out.push(cc);
                i++;
            }
            continue;
        }

        if (c === '`') { out.push('`'); i++; break; }
        out.push(c);
        i++;
    }
    return i;
}

function parseRegex(code, i, out) {
    out.push('/');
    i++;
    let inClass = false;
    while (i < code.length) {
        const c = code[i];
        if (c === '\\') { out.push(code[i], code[i+1]||''); i += 2; continue; }
        if (c === '[') inClass = true;
        if (c === ']') inClass = false;
        if (c === '/' && !inClass) {
            out.push(c); i++;
            while (i < code.length && /[gimsuy]/.test(code[i])) { out.push(code[i]); i++; }
            break;
        }
        out.push(c);
        i++;
    }
    return i;
}

function prevNonWs(str, pos) {
    let j = pos - 1;
    while (j >= 0 && /\s/.test(str[j])) j--;
    return j >= 0 ? str[j] : null;
}

function processFile(filePath) {
    const original = fs.readFileSync(filePath, 'utf-8');
    const cleaned = stripComments(original);
    if (original !== cleaned) {
        fs.writeFileSync(filePath, cleaned, 'utf-8');
        const removed = original.length - cleaned.length;
        console.log('  \u2713 ' + path.relative(SRC_DIR, filePath) + ' (' + removed + ' chars removed)');
        return true;
    }
    console.log('  - ' + path.relative(SRC_DIR, filePath) + ' (no changes)');
    return false;
}

// Main
console.log('\nStripping comments from .ts files...\n');
const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.ts'));
let count = 0;
for (const f of files) {
    if (processFile(path.join(SRC_DIR, f))) count++;
}
console.log('\nDone. ' + count + '/' + files.length + ' files modified.\n');

