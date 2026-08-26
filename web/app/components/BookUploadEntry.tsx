import Link from "next/link";

import styles from "../home.module.css";

export function BookUploadEntry() {
  return (
      <Link
        className={styles.primaryAction}
        href="/agent"
      >
        <span>上传书籍</span>
        <span className={styles.primaryActionArrow} aria-hidden="true">
          →
        </span>
      </Link>
  );
}
