#!/usr/bin/env python3
"""
CSV 파일에서 특정 날짜까지의 데이터만 필터링하는 스크립트
2025-06-03까지의 데이터만 남기고 2025-06-04 이후 데이터는 제거
"""

import csv
from datetime import datetime
import sys

def filter_csv_by_date(input_file, output_file, cutoff_date_str):
    """
    CSV 파일을 읽어서 특정 날짜까지의 데이터만 필터링
    
    Args:
        input_file (str): 입력 CSV 파일 경로
        output_file (str): 출력 CSV 파일 경로
        cutoff_date_str (str): 기준 날짜 (YYYY-MM-DD 형식)
    """
    
    # 기준 날짜를 datetime 객체로 변환
    cutoff_date = datetime.strptime(cutoff_date_str, '%Y-%m-%d')
    
    # 필터링된 행들을 저장할 리스트
    filtered_rows = []
    
    try:
        with open(input_file, 'r', encoding='utf-8') as infile:
            reader = csv.reader(infile)
            
            # 헤더 행 추가
            header = next(reader)
            filtered_rows.append(header)
            
            # 데이터 행들 필터링
            for row_num, row in enumerate(reader, start=2):  # 2부터 시작 (헤더 제외)
                if len(row) >= 7:  # 최소 7개 컬럼이 있는지 확인
                    try:
                        # UPDATED_AT 컬럼 (7번째 컬럼, 인덱스 6)에서 날짜 추출
                        updated_at_str = row[6].strip()
                        
                        # 날짜 형식이 여러 가지일 수 있으므로 처리
                        if ' ' in updated_at_str:
                            # "2025-06-03 00:42:08" 형식
                            date_part = updated_at_str.split(' ')[0]
                        else:
                            # "2025-06-03" 형식
                            date_part = updated_at_str
                        
                        # 날짜 파싱
                        row_date = datetime.strptime(date_part, '%Y-%m-%d')
                        
                        # 기준 날짜 이하인 경우만 포함
                        if row_date <= cutoff_date:
                            filtered_rows.append(row)
                        else:
                            print(f"제거됨 (행 {row_num}): {updated_at_str} - {row[0:3]}...")
                            
                    except ValueError as e:
                        print(f"경고: 행 {row_num}의 날짜 파싱 실패: {row[6]} - {e}")
                        # 날짜 파싱에 실패한 경우 기본적으로 포함
                        filtered_rows.append(row)
                else:
                    print(f"경고: 행 {row_num}의 컬럼 수 부족: {len(row)}개")
                    # 컬럼 수가 부족한 경우 기본적으로 포함
                    filtered_rows.append(row)
        
        # 필터링된 데이터를 출력 파일에 저장
        with open(output_file, 'w', encoding='utf-8', newline='') as outfile:
            writer = csv.writer(outfile)
            writer.writerows(filtered_rows)
        
        print(f"\n✅ 필터링 완료!")
        print(f"📊 원본 데이터: {sum(1 for line in open(input_file)) - 1}행 (헤더 제외)")
        print(f"📊 필터링된 데이터: {len(filtered_rows) - 1}행 (헤더 제외)")
        print(f"🗑️  제거된 데이터: {sum(1 for line in open(input_file)) - len(filtered_rows)}행")
        print(f"📅 기준 날짜: {cutoff_date_str} (이하)")
        print(f"💾 출력 파일: {output_file}")
        
    except FileNotFoundError:
        print(f"❌ 오류: 파일을 찾을 수 없습니다: {input_file}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 오류: {e}")
        sys.exit(1)

if __name__ == "__main__":
    # 파일 경로 설정
    input_file = "purchase_history_origin.csv"
    output_file = "purchase_history.csv"
    cutoff_date = "2025-06-04"
    
    print(f"🔍 CSV 파일 날짜 필터링 시작...")
    print(f"📁 입력 파일: {input_file}")
    print(f"📁 출력 파일: {output_file}")
    print(f"📅 기준 날짜: {cutoff_date} (이하)")
    print("-" * 50)
    
    # 필터링 실행
    filter_csv_by_date(input_file, output_file, cutoff_date)
