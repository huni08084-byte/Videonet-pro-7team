# Python 3.11 이미지 사용
FROM python:3.10-slim

# 작업 디렉토리 설정
WORKDIR /app

# 시스템 패키지 업데이트
RUN apt-get update && apt-get install -y python3-opencv \
    gcc \
    && rm -rf /var/lib/apt/lists/*


# requirements.txt 복사 및 설치
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# 애플리케이션 코드 복사
COPY . .

# 데이터베이스 디렉토리 생성
RUN mkdir -p /app/data

# 포트 설정
EXPOSE 7701

# 서버 실행
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7701"]