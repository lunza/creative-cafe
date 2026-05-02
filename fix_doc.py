import os

# Read the clean file
with open(r'D:\AI\travernManager\PROJECT_DOCUMENTATION_NEW.md', 'r', encoding='utf-8') as f:
    clean_content = f.read()

# Write to the original file
with open(r'D:\AI\travernManager\PROJECT_DOCUMENTATION.md', 'w', encoding='utf-8') as f:
    f.write(clean_content)

print("File replaced successfully!")
