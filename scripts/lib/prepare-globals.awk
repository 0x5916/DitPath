# Wrap complete top-level CREATE ROLE statements; leave all other SQL untouched.
# role_tag must be a dollar delimiter absent from the input. final_newline records
# whether the input ended in LF, because portable awk strips record separators.
function fail(message) { print "prepare-globals: " message > "/dev/stderr"; exit 1 }
BEGIN { if (final_newline == "") final_newline = 1 }
{ if (NR > 1) sql = sql "\n"; sql = sql $0 }
END {
  if (NR && final_newline) sql = sql "\n"
  if (role_tag !~ /^\$[A-Za-z_][A-Za-z0-9_]*\$$/ || index(sql, role_tag))
    fail("invalid or nonunique role delimiter")
  size = length(sql); cursor = 1; i = 1
  while (i <= size) {
    char = substr(sql, i, 1); pair = substr(sql, i, 2)
    if (depth) {
      if (pair == "/*") { depth++; i += 2 }
      else if (pair == "*/") { depth--; i += 2 }
      else i++
      continue
    }
    if (quote != "") {
      if (escape && char == "\\") i += 2
      else if (char == quote && substr(sql, i + 1, 1) == quote) i += 2
      else { if (char == quote) quote = ""; i++ }
      continue
    }
    if (pair == "--" || (!tokens && char == "\\")) {
      offset = index(substr(sql, i), "\n")
      i = offset ? i + offset : size + 1
      continue
    }
    if (pair == "/*") { depth = 1; i += 2; continue }
    if (char == "\047" || char == "\042") {
      quote = char
      escape = char == "\047" && substr(sql, i - 1, 1) ~ /^[Ee]$/ &&
        (i < 3 || substr(sql, i - 2, 1) !~ /[[:alnum:]_$]/)
      if (!tokens) tokens = 2
      i++; continue
    }
    if (char == "$" && (i == 1 || substr(sql, i - 1, 1) !~ /[[:alnum:]_$]/) &&
        match(substr(sql, i), /^\$([[:alpha:]_][[:alnum:]_]*)?\$/)) {
      delimiter = substr(sql, i, RLENGTH); width = length(delimiter)
      offset = index(substr(sql, i + width), delimiter)
      if (!offset) fail("unterminated dollar-quoted string")
      if (!tokens) tokens = 2
      i += width + offset - 1 + width; continue
    }
    if (char ~ /[[:alpha:]_]/) {
      end = i + 1
      while (end <= size && substr(sql, end, 1) ~ /[[:alnum:]_$]/) end++
      word = toupper(substr(sql, i, end - i))
      if (!tokens) { first = word; start = i; tokens = 1 }
      else if (tokens == 1) { role = first == "CREATE" && word == "ROLE"; tokens = 2 }
      i = end; continue
    }
    if (char == ";") {
      if (role) {
        printf "%sDO %s BEGIN %s EXCEPTION WHEN duplicate_object THEN NULL; END; %s;", \
          substr(sql, cursor, start - cursor), role_tag, substr(sql, start, i - start + 1), role_tag
      } else printf "%s", substr(sql, cursor, i - cursor + 1)
      cursor = i + 1; tokens = 0; role = 0; first = ""
    } else if (char !~ /[[:space:]]/ && !tokens) tokens = 2
    i++
  }
  if (depth || quote != "") fail("unterminated SQL quote or comment")
  printf "%s", substr(sql, cursor)
}
