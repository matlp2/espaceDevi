


function generate_pie_html(json) {

	console.log('generate_pie_html', {json})

	return fetch('pie_chart/pie3D.html')
		.then(response => response.text())
		.then(text => {

			const i_deb = text.search('//INPUT_DATA DEB\n') + '//INPUT_DATA DEB\n'.length
			const i_fin = text.search('//INPUT_DATA FIN')

			

			function csv_table_from_csv_text(csv_txt){
				let i = 0, i_av = i
				const table = []
				const len = csv_txt.length
				while (i < len) {
					const line = []
					line_loop:while(1) {
						if (i == len){
							line.push(csv_txt.substring(i_av,i))
							break
						}
						else{
							switch(csv_txt[i]) {
								case ';':
									{
										line.push(csv_txt.substring(i_av,i))
										i_av = ++i
									}
									break
								case '\n':
									{
										line.push(csv_txt.substring(i_av,i))
										i_av = ++i
										break line_loop;
									}
									break
								case '"':
									{
										++i
										for(; i < len && csv_txt[i] != '"'; ++i) {}
										++i
									}
									break
								default:
									++i
							}
						}
					}
					table.push(line)
				}
				return table
			}

			if(json.startsWith('localStorage:')) json = json.substring('localStorage:'.length)

			const csv_txt = localStorage.getItem(json)

			const table = csv_table_from_csv_text(csv_txt)


			function make_element(line_index) {
				return `{
					'name' : '${table[line_index][0]}',
					'quantity': ${table[line_index][1]},
					'color': new Float32Array([${Math.random()},${Math.random()},${Math.random()},1])
				}`
				
			}

			const input_data = `
			let input_data = [
				${table.filter((line,index)=>index>=1).map((line,index)=>make_element(index+1)).join(',')}
			];
			`

			text = text.substring(0, i_deb) + input_data + text.substring(i_fin)

			const new_tab = window.open()
			new_tab.document.write(text)
		})
}

