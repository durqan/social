const fs = require('node:fs');
const path = require('node:path');

const cmakeFile =
    process.argv[2] ||
    path.resolve(
        __dirname,
        '../android/app/build/generated/autolinking/src/main/jni/Android-autolinking.cmake',
    );

if (!fs.existsSync(cmakeFile)) {
    console.log(`[patch-autolinking-cmake] skip, file not found: ${cmakeFile}`);
    process.exit(0);
}

const original = fs.readFileSync(cmakeFile, 'utf8');
const missingCodegenLibraries = new Set();

const patchedLines = original.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*add_subdirectory\("([^"]+)"\s+([^)]+)\)\s*$/);

    if (!match) {
        return [line];
    }

    const cmakeDirRaw = match[1];
    const targetName = match[2].trim();

    const cmakeDir = cmakeDirRaw.replace(/\\ /g, ' ');
    const cmakeListsFile = path.join(cmakeDir, 'CMakeLists.txt');

    if (fs.existsSync(cmakeListsFile)) {
        return [line];
    }

    const codegenTargetMatch = targetName.match(/^(.+)_autolinked_build$/);

    if (codegenTargetMatch) {
        missingCodegenLibraries.add(`react_codegen_${codegenTargetMatch[1]}`);
    }

    return [
        `# [patched] skipped missing autolink CMake dir: ${cmakeDirRaw}`,
        `# ${line}`,
    ];
});

let patched = patchedLines.join('\n');

for (const libraryName of missingCodegenLibraries) {
    const escaped = libraryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    patched = patched.replace(
        new RegExp(`(^|\\n)(\\s*)${escaped}(?=\\s|\\n|\\))`, 'g'),
        (_full, lineBreak, indent) =>
            `${lineBreak}${indent}# [patched] skipped missing library ${libraryName}`,
    );
}

if (patched !== original) {
    fs.writeFileSync(cmakeFile, patched);
    console.log(
        `[patch-autolinking-cmake] patched ${cmakeFile}; skipped libraries: ${
            [...missingCodegenLibraries].join(', ') || 'none'
        }`,
    );
} else {
    console.log(`[patch-autolinking-cmake] no changes needed: ${cmakeFile}`);
}