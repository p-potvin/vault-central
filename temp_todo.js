const fs = require('fs');
let text = fs.readFileSync('TODO.md', 'utf-8');
text = text.replace(
  '- [ ] **Console/Debug Purge**: A large volume of',
  '- [x] **Console/Debug Purge**: A large volume of'
);
fs.writeFileSync('TODO.md', text);
